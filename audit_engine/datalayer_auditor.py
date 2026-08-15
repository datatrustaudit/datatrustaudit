"""
audit_engine.datalayer_auditor — dataLayer structure and PII exposure detection.

Inspects all dataLayer.push() calls for:
- PII keys (email, phone, CPF, etc.)
- eCommerce items array structure
- Initialization order issues

## Por que o casamento é por segmento, e não por substring

A primeira versão perguntava `if termo in chave.lower()`. Contra um
`dataLayer.push` corriqueiro de e-commerce isso produzia quatro acusações de
exposição de dado pessoal, todas com `confidence=high`:

    "rg"   dentro de o**rg**anization        -> critical
    "cep"  dentro de ac**cep**ted            -> high
    "name" dentro de item_name, page_name    -> medium
    "uid"  dentro de u**uid**                -> medium

O estrago não para no achado: `pii_exposure` é o tipo que o veredito do laudo
trata como o mais grave de todos. Um `item_name` de camiseta abria o laudo com
a acusação mais pesada que o produto sabe fazer — e quando o cliente confere e
não encontra, ele deixa de confiar no laudo inteiro, inclusive na parte certa.

Regra atual: a chave é quebrada nos limites de `snake_case`, `kebab-case`,
`camelCase`, `PascalCase` e na fronteira letra/dígito, e o termo é comparado
contra o **segmento inteiro**. Termo de mais de uma palavra (`first_name`) casa
como sequência de segmentos adjacentes. Só termo longo e sem colisão conhecida
(`email`, `cpf`, `nascimento`) aceita prefixo/sufixo dentro do segmento, o que
cobre plural e forma colada sem reabrir a porta da substring solta.

## `name` não é termo, mas nome de pessoa continua sendo achado

Tirar `name` do catálogo resolve `item_name`/`page_name` e cria o problema
oposto: uma lista fechada de pares (`first_name`, `last_name`, …) nunca cobre
o campo seguinte. `middle_name`, `surname`, `billing_name`, `shipping_name`,
`cardholder_name` e `name_on_card` — todos campo de checkout, todos nome de
pessoa — pararam de ser detectados quando o catálogo virou enumeração.

Comprar silêncio é a forma mais barata de zerar falso positivo e a mais cara
no laudo. Por isso a regra é dita uma vez, não enumerada: `name`/`nome` vale
como dado pessoal quando o segmento **vizinho** é qualificador de pessoa
(`first`, `billing`, `holder`, `cliente`, …). `item`, `page`, `event`,
`product`, `list` e `category` não estão na lista de qualificadores, e é por
isso que o push de e-commerce continua limpo.

## Ausência de formato só rebaixa quando o validador é conclusivo

`mascarador._TELEFONE` recusa número sem formatação **de propósito**: o `cid`
do GA4 (`847362819.1691582734`) tem cara de telefone cru, e mascará-lo
apagaria a ligação entre requisições da mesma sessão. Usar essa recusa como
prova de que o valor não é telefone inverte o sentido da regra: `phone:
'11987654321'` — um celular de São Paulo — era rebaixado e o laudo afirmava
"o valor observado não tem esse formato".

Só CPF, CNPJ, cartão e e-mail têm validação conclusiva (dígito verificador,
Luhn, forma do endereço). Para telefone a varredura pode **confirmar**, nunca
negar — e o laudo diz isso em vez de negar por conta própria.

## Valor de modelo não é valor observado

`cpf: '{{DLV - CPF}}'` é o container do GTM, não o CPF de ninguém: o valor
real só existe no navegador do visitante. O mesmo vale para `${...}`, `<%=
%>`, `%%...%%` e para a string `"undefined"`. Tratá-los como valor observado
fazia o laudo afirmar que conferiu e não bateu — quando não havia o que
conferir. Hash hexadecimal (32 a 128 caracteres) também é dito como hash: é
justamente a prática que a recomendação do produto manda adotar, e chamá-la
de "dado em texto claro" contradiz o próprio laudo.

## Por que o valor também é conferido

Chave `cpf` cujo valor tem dígito verificador válido é evidência; chave `cpf`
cujo valor é `undefined` é indício. As duas viravam `critical` com
`confidence=high`. A validação vem de `audit_engine/mascarador.py`, que já
valida CPF, CNPJ, cartão (Luhn), e-mail e telefone — reaproveitada aqui em vez
de reimplementada, para que o laudo não tenha duas noções de "isso é um CPF".

`confidence=high` agora significa **formato do valor conferido**. Quando o
valor não é observável (`{{DLV - CPF}}`, variável, objeto aninhado) a
severidade é mantida e a confiança cai — o laudo diz que não viu o valor, em
vez de fingir que viu.

## O trecho guardado passa por DOIS filtros — e o corte vem depois dos dois

`snippet` ia cru para `raw_data` e daí para o banco. Num push de checkout isso
significava gravar o CPF e o e-mail do comprador dentro do produto que audita
vazamento de dado pessoal. O laudo aponta o local, nunca o conteúdo.

São dois filtros porque são dois motivos de sigilo, e cada um sozinho deixa
metade passar:

- `_redige_valores_de_pii` apaga pelo **nome da chave**. Senha, RG, CEP,
  endereço, nascimento e nome de pessoa não têm formato reconhecível — são dado
  pessoal por causa da chave —, então atravessavam o mascarador intactos.
  Medido: `{senha:'MinhaSenh@123'}` era gravado inteiro.
- `mascarar_texto` apaga pela **forma do valor**, e é o que pega um CPF escrito
  dentro de `observacao`, que chave nenhuma denuncia.

Mascarar depois de cortar não resolve: o corte parte o valor ao meio, o
pedaço restante não casa mais com o padrão e passa intacto pelo mascarador.
Era um vazamento silencioso — `cpf:'529.982.247-2` e `user_email:'joaodasilva@e`
foram gravados assim. Filtre o texto inteiro e só então corte.
"""
import re
import json
from dataclasses import dataclass
from typing import Any, Dict, FrozenSet, List, Optional, Tuple
from .models import DataLayerFinding, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, CONFIDENCE_LOW
from .mascarador import mascarar_texto

_DL_PUSH_RE = re.compile(
    r"dataLayer\s*\.\s*push\s*\(\s*(\{[\s\S]{0,2000}?\})\s*\)",
    re.IGNORECASE,
)
_DL_INIT_RE = re.compile(r"window\s*\.\s*dataLayer\s*=\s*\[\s*\]", re.IGNORECASE)

#: Ordem de gravidade, da menor para a maior. Usada para rebaixar e para
#: escolher o pior achado quando a mesma chave casa com mais de um termo.
_ESCADA_DE_GRAVIDADE = ("low", "medium", "high", "critical")

#: Ordem de confiança, da menor para a maior.
_ESCADA_DE_CONFIANCA = (CONFIDENCE_LOW, CONFIDENCE_MEDIUM, CONFIDENCE_HIGH)


def _posto(gravidade: str, confianca: str) -> Tuple[int, int]:
    """Ordena leituras da mesma chave: gravidade primeiro, confiança no empate."""
    return (
        _ESCADA_DE_GRAVIDADE.index(gravidade),
        _ESCADA_DE_CONFIANCA.index(confianca),
    )


@dataclass(frozen=True)
class TermoPII:
    """Um termo do catálogo de dado pessoal.

    `termo` é escrito na forma legível (`first_name`) e quebrado em segmentos
    na carga do módulo — é a mesma quebra aplicada à chave do dataLayer, então
    `first_name`, `firstName` e `first-name` casam com a mesma entrada.

    `tolerante` libera prefixo/sufixo dentro de um segmento (`emails` casa
    `email`). Só vale para termo sem colisão conhecida: `phone` é intolerante
    porque casaria `smartphone`, que é categoria de produto, e `birth` porque
    casaria `birthstone`, que é joia.

    `formato` diz qual validador de `mascarador` confere o valor. `None`
    significa que não há como conferir — e o laudo passa a dizer isso.
    """
    termo: str
    gravidade: str
    tolerante: bool = False
    formato: Optional[str] = None


#: Catálogo de termos. Cada `tolerante=False` está assim por um motivo escrito:
#: são os que já produziram, ou produziriam, falso positivo por substring.
TERMOS_PII: Tuple[TermoPII, ...] = (
    # --- Documentos: formato conferível, é a evidência mais forte que há ---
    TermoPII("cpf", "critical", tolerante=True, formato="cpf"),
    TermoPII("cnpj", "high", tolerante=True, formato="cnpj"),
    # "rg" exato: casava organization, pergunta, target, large, argumento.
    TermoPII("rg", "critical"),
    TermoPII("registro_geral", "critical"),

    # --- Contato ---
    TermoPII("email", "critical", tolerante=True, formato="email"),
    TermoPII("e-mail", "critical", formato="email"),
    # "phone" exato: casaria smartphone e headphone, que em e-commerce são
    # categoria de produto, não dado do titular.
    TermoPII("phone", "high", formato="telefone"),
    TermoPII("telephone", "high", formato="telefone"),
    TermoPII("telefone", "high", tolerante=True, formato="telefone"),
    TermoPII("celular", "high", tolerante=True, formato="telefone"),
    TermoPII("whatsapp", "high", formato="telefone"),

    # --- Nome ---
    # `name` sozinho saiu do catálogo: em dataLayer de e-commerce ele é
    # item_name, page_name, event_name, category_name — nenhum é dado pessoal.
    # Quem decide o caso qualificado (`first_name`, `billing_name`, …) é
    # `_nome_de_pessoa`, e não uma lista de pares aqui — a lista sempre ficava
    # um campo atrás do checkout do cliente.
    #
    # Aqui ficam só as formas **coladas**, que a quebra em segmentos não
    # separa: para o casador, `firstname` é um segmento só.
    TermoPII("firstname", "high"),
    TermoPII("lastname", "high"),
    TermoPII("fullname", "high"),
    TermoPII("middlename", "high"),
    TermoPII("surname", "high"),
    TermoPII("username", "medium"),
    TermoPII("nickname", "medium"),
    # `name_on_card` é nome de pessoa sem qualificador vizinho: entre `name` e
    # `card` está a preposição, que não é qualificador.
    TermoPII("name_on_card", "high"),
    # "nome" exato: casaria nomenclatura. `sobrenome` entra por conta própria,
    # justamente porque o exato não o alcança.
    TermoPII("nome", "high"),
    TermoPII("sobrenome", "high"),

    # --- Credencial ---
    TermoPII("password", "critical"),
    TermoPII("senha", "critical"),

    # --- Nascimento ---
    # "birth" exato: casaria birthstone, que é pedra de joalheria.
    TermoPII("birth", "high"),
    TermoPII("birthdate", "high"),
    TermoPII("birthday", "high"),
    TermoPII("nascimento", "high", tolerante=True),

    # --- Endereço ---
    TermoPII("address", "high"),
    TermoPII("endereco", "high", tolerante=True),
    # "cep" exato: casava accepted (cookie_accepted), exception, receptor.
    TermoPII("cep", "high"),

    # --- Cartão: só a forma composta. "card" sozinho casaria gift_card,
    #     card_type e cardholder_country, que não carregam o número.
    TermoPII("card_number", "critical", formato="cartao"),
    TermoPII("cardnumber", "critical", formato="cartao"),
    TermoPII("numero_cartao", "critical", formato="cartao"),

    # --- Identificador pseudonimizado ---
    # Não é PII direta: `user_id` é campo recomendado do GA4. Fica no catálogo
    # porque sob a LGPD identificador vinculável é dado pessoal, mas em
    # gravidade baixa — subir isso a critical transformaria instrumentação
    # correta em acusação. "uid" exato: casava uuid e guid.
    TermoPII("user_id", "low"),
    TermoPII("uid", "low"),
)

#: Compatibilidade: o mapa antigo `termo -> gravidade`. Mantido porque é nome
#: público do módulo; a decisão de casamento não passa mais por ele.
PII_KEYS: Dict[str, str] = {t.termo: t.gravidade for t in TERMOS_PII}

#: O segmento que, ao lado de um qualificador de pessoa, vira dado pessoal.
_SEGMENTOS_DE_NOME = frozenset({"name", "nome"})

#: Qualificadores que identificam a pessoa. Nenhum deles aparece nos campos de
#: e-commerce do GA4 (`item_name`, `item_list_name`, `promotion_name`,
#: `creative_name`, `page_name`, `event_name`), que é o que precisa continuar
#: fora do laudo.
_QUALIFICADOR_DE_PESSOA_FORTE = frozenset({
    # Partes do nome
    "first", "last", "middle", "full", "given", "family", "sur",
    "primeiro", "ultimo", "segundo", "completo",
    # Papel da pessoa na transação
    "customer", "client", "contact", "buyer", "shopper", "recipient",
    "receiver", "holder", "cardholder", "owner", "person", "passenger",
    "guest", "patient", "subscriber", "employee", "member", "lead",
    "cliente", "comprador", "consumidor", "titular", "portador",
    "destinatario", "responsavel", "contato", "pessoa", "passageiro",
    "hospede", "paciente", "assinante", "beneficiario", "socio",
    # Endereço de cobrança/entrega: o nome ali é o do titular
    "billing", "shipping", "delivery", "cobranca", "entrega", "faturamento",
})

#: Qualificadores de identidade **pseudônima**: o valor é um apelido de conta,
#: não necessariamente o nome civil. Entram em gravidade menor pelo mesmo
#: motivo de `user_id` — instrumentação comum não pode virar a acusação mais
#: pesada do laudo.
#:
#: `screen` ficou de fora de propósito: `screen_name` é parâmetro padrão do
#: GA4 para aplicativo e nomeia a tela, não a pessoa.
_QUALIFICADOR_DE_PESSOA_FRACO = frozenset({
    "user", "usuario", "account", "conta", "login", "display",
    "profile", "perfil", "nick", "apelido",
})

#: Formatos cuja **ausência** é conclusiva: CPF e CNPJ têm dígito verificador,
#: cartão tem Luhn e e-mail tem forma fechada. `telefone` está fora de
#: propósito — ver o cabeçalho do módulo: o validador recusa número sem
#: formatação para não estragar o `cid` do GA4, então não ver telefone ali não
#: prova que o valor não é um telefone.
_FORMATOS_CONCLUSIVOS = frozenset({"cpf", "cnpj", "cartao", "email"})

#: Valor que é modelo, e não dado: o container do GTM, o template literal do
#: JS, o marcador de servidor. Nada disso foi observado — o valor real só
#: existe no navegador do visitante.
_PLACEHOLDER_RE = re.compile(
    r"""^\s*(?:
        \{\{.*\}\}      # {{DLV - CPF}}
      | \$\{.*\}        # ${cpf}
      | <%.*%>          # <%= @cpf %>
      | %%.*%%          # %%CPF%%
      | \[\[.*\]\]      # [[cpf]]
      | undefined | null | nan
    )\s*$""",
    re.IGNORECASE | re.DOTALL | re.VERBOSE,
)

#: Hash hexadecimal nos tamanhos usuais (md5, sha1, sha224/256/384/512).
#: Exige ao menos uma letra `a-f` para não confundir com identificador
#: numérico longo.
_TAMANHOS_DE_HASH = frozenset({32, 40, 56, 64, 96, 128})
_SO_HEXADECIMAL_RE = re.compile(r"^[0-9a-f]+$", re.IGNORECASE)
_TEM_LETRA_HEX_RE = re.compile(r"[a-f]", re.IGNORECASE)

#: Quebra nos separadores explícitos (`_`, `-`, `.`, espaço) e também na
#: fronteira camelCase/PascalCase e letra/dígito.
_SEPARADOR_RE = re.compile(r"[^A-Za-z0-9]+")
_FRONTEIRA_RE = re.compile(
    r"(?<=[a-z0-9])(?=[A-Z])"        # userEmail -> user | Email
    r"|(?<=[A-Z])(?=[A-Z][a-z])"     # userCPFData -> user | CPF | Data
    r"|(?<=[A-Za-z])(?=[0-9])"       # email2 -> email | 2
    r"|(?<=[0-9])(?=[A-Za-z])"
)

#: Chave de objeto JS no texto cru, com o literal simples que a segue quando
#: existe. Usada só quando o push não pôde ser parseado.
#:
#: A última alternativa não extrai nada: ela existe para **consumir** o literal
#: de texto que não ocupou posição de valor. Sem ela, a vírgula de dentro de
#: uma string era lida como separador de campo e o que vinha depois virava
#: chave: `tags:['promo, senha: 1']` rendia um achado `senha` **critical** que
#: nunca esteve no push. É a mesma família do defeito que esta correção veio
#: fechar — termo casado dentro do valor —, só que numa janela mais estreita.
_CHAVE_CRUA_RE = re.compile(
    r"""(?:^|[{,])\s*
        (?:"([^"\r\n]{1,60})"|'([^'\r\n]{1,60})'|([A-Za-z_$][\w$]{0,59}))
        \s*:\s*
        (?:"([^"\r\n]{0,200})"|'([^'\r\n]{0,200})'|(-?\d[\d.,+\-]{0,40}))?
      | "(?:\\.|[^"\\\r\n])*"
      | '(?:\\.|[^'\\\r\n])*'""",
    re.VERBOSE,
)


def _safe_parse(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    try:
        cleaned = re.sub(r"'([^']*)'", r'"\1"', text)
        cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)
        cleaned = re.sub(r'(?<=[{,\s])(\w+)\s*:', r'"\1":', cleaned)
        return json.loads(cleaned)
    except Exception:
        return None


def _segmentos(chave: str) -> List[str]:
    """Quebra a chave em segmentos comparáveis, em minúsculas.

    `ecommerce.items.item_name` -> ['ecommerce', 'items', 'item', 'name']
    `userCPF`                   -> ['user', 'cpf']
    `uuid`                      -> ['uuid']   (e por isso 'uid' não casa)
    """
    partes: List[str] = []
    for bruto in _SEPARADOR_RE.split(chave or ""):
        if not bruto:
            continue
        for pedaco in _FRONTEIRA_RE.split(bruto):
            if pedaco:
                partes.append(pedaco.lower())
    return partes


def _termo_casa(segmentos: List[str], termo: TermoPII) -> bool:
    """Casa o termo contra os segmentos da chave — nunca contra a chave crua."""
    alvo = _segmentos(termo.termo)
    if not alvo or not segmentos:
        return False

    if len(alvo) == 1:
        unico = alvo[0]
        for seg in segmentos:
            if seg == unico:
                return True
            # Prefixo/sufixo cobre plural (`emails`) e forma colada
            # (`cpfCliente` já vem quebrado, mas `cpfcliente` não).
            if termo.tolerante and len(seg) > len(unico) and (
                seg.startswith(unico) or seg.endswith(unico)
            ):
                return True
        return False

    # Termo composto: exige os segmentos adjacentes e na ordem.
    for i in range(len(segmentos) - len(alvo) + 1):
        if segmentos[i:i + len(alvo)] == alvo:
            return True
    return False


def _rebaixa(gravidade: str) -> str:
    i = _ESCADA_DE_GRAVIDADE.index(gravidade)
    return _ESCADA_DE_GRAVIDADE[max(0, i - 1)]


def _nome_de_pessoa(segmentos: List[str]) -> Optional[str]:
    """Gravidade quando `name`/`nome` tem qualificador de pessoa ao lado.

    Só o segmento imediatamente anterior ou posterior conta. `item_name`,
    `page_name` e `promotion_name` não têm qualificador vizinho e por isso
    continuam fora do laudo; `billing_name` e `middle_name` têm, e voltaram.

    `nome` sozinho não passa por aqui — ele é termo do catálogo, porque em
    português a chave costuma vir como `nome`, `nome_completo` ou
    `nome_do_titular`, onde o vizinho é uma preposição.
    """
    for i, seg in enumerate(segmentos):
        if seg not in _SEGMENTOS_DE_NOME:
            continue
        vizinhos = []
        if i > 0:
            vizinhos.append(segmentos[i - 1])
        if i + 1 < len(segmentos):
            vizinhos.append(segmentos[i + 1])
        for vizinho in vizinhos:
            if vizinho in _QUALIFICADOR_DE_PESSOA_FORTE:
                return "high"
            if vizinho in _QUALIFICADOR_DE_PESSOA_FRACO:
                return "medium"
    return None


def _candidato(chave: str) -> Optional[Tuple[str, Optional[str]]]:
    """`(gravidade, formato)` do melhor casamento, ou `None` se a chave não é PII.

    Quando mais de um termo casa a mesma chave (`email_address` casa `email` e
    `address`), vence o mais grave — senão a chave mais perigosa seria
    reportada pela sua leitura mais branda. No empate de gravidade vence quem
    tem validador: só assim o valor entra na conta.
    """
    segmentos = _segmentos(chave)
    candidatos: List[Tuple[str, Optional[str]]] = [
        (t.gravidade, t.formato) for t in TERMOS_PII if _termo_casa(segmentos, t)
    ]
    gravidade_do_nome = _nome_de_pessoa(segmentos)
    if gravidade_do_nome:
        candidatos.append((gravidade_do_nome, None))
    if not candidatos:
        return None
    return max(
        candidatos,
        key=lambda c: (_ESCADA_DE_GRAVIDADE.index(c[0]), c[1] is not None),
    )


def _texto_do_valor(valor: Any) -> Optional[str]:
    """Só devolve texto quando há um valor escalar **observado** para conferir.

    `bool` é checado antes de `int` porque em Python `True` é `int` — e "1"
    não é valor a conferir. Objeto, lista, `None`, string vazia e modelo do
    GTM (`{{DLV - CPF}}`) viram `None`: o valor não foi observado, e o laudo
    vai dizer isso em vez de conferir o texto do modelo contra o formato de
    um CPF e anunciar que não bate.
    """
    if isinstance(valor, str):
        texto = valor.strip()
        if not texto or _PLACEHOLDER_RE.match(texto):
            return None
        return valor
    if isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return str(valor)
    return None


def _e_hash(texto: str) -> Optional[int]:
    """Tamanho da cadeia quando o valor é hexadecimal puro; `None` caso contrário.

    Dado hasheado é o que a própria recomendação do laudo manda usar. Chamá-lo
    de "dado pessoal em texto claro" contradiz a recomendação que vem duas
    telas depois, e contradição num laudo derruba o resto junto.
    """
    limpo = texto.strip()
    if len(limpo) not in _TAMANHOS_DE_HASH:
        return None
    if not _SO_HEXADECIMAL_RE.match(limpo) or not _TEM_LETRA_HEX_RE.search(limpo):
        return None
    return len(limpo)


#: Motivo usado quando não há validador para o tipo de dado da chave.
_SEM_VALIDADOR = ("esta varredura não tem como conferir o formato deste tipo "
                  "de dado — o indício é o nome da chave")
#: Motivo usado quando o valor não chegou a ser observado.
_VALOR_NAO_OBSERVADO = ("o valor não foi observado no código-fonte (variável, "
                        "modelo do GTM ou objeto aninhado) — o indício é o "
                        "nome da chave")


def _avalia(chave: str, valor: Any) -> Optional[Tuple[str, str, str]]:
    """Devolve `(gravidade, confianca, motivo)` ou `None` se a chave não é PII.

    `confidence=high` significa **formato do valor validado**. Toda outra
    saída declara por que não foi possível chegar lá — nenhuma delas afirma
    algo que a varredura não viu.
    """
    candidato = _candidato(chave)
    if candidato is None:
        return None
    gravidade, formato = candidato

    texto = _texto_do_valor(valor)
    if texto is None:
        return (gravidade, CONFIDENCE_MEDIUM,
                _SEM_VALIDADOR if formato is None else _VALOR_NAO_OBSERVADO)

    tamanho_do_hash = _e_hash(texto)
    if tamanho_do_hash:
        # Rebaixa: continua sendo dado pessoal pseudonimizado, mas não é o
        # dado em claro que o achado alegaria.
        return (
            _rebaixa(gravidade),
            CONFIDENCE_MEDIUM,
            f"o valor observado é uma cadeia de {tamanho_do_hash} caracteres "
            "hexadecimais (hash ou identificador), e não o dado em texto claro",
        )

    if formato is None:
        return (gravidade, CONFIDENCE_MEDIUM, _SEM_VALIDADOR)

    _, tipos = mascarar_texto(texto)
    if formato in tipos:
        return (
            gravidade,
            CONFIDENCE_HIGH,
            "o valor observado tem o formato de "
            f"{formato} (validado, não apenas parecido)",
        )

    if formato not in _FORMATOS_CONCLUSIVOS:
        # Não ver telefone não prova que não é telefone — ver o cabeçalho do
        # módulo. Mantém a gravidade e diz que não deu para conferir.
        return (
            gravidade,
            CONFIDENCE_MEDIUM,
            f"esta varredura só confirma {formato} quando o valor vem "
            "formatado, então o formato deste não pôde ser conferido — o "
            "indício é o nome da chave",
        )

    # Rebaixa: o nome da chave continua sendo indício, mas o valor que a
    # varredura viu não passou na validação.
    return (
        _rebaixa(gravidade),
        CONFIDENCE_MEDIUM,
        f"o nome da chave indica {formato}, mas o valor observado não passou "
        f"na validação de {formato} (pode ser dado de teste ou já mascarado)",
    )


def _flatten_entries(obj: Any, prefix: str = "") -> List[Tuple[str, Any]]:
    """Coleta `(caminho, valor)` de toda a estrutura aninhada.

    O valor vem junto porque é ele que separa `cpf: '529.982.247-25'` de
    `cpf: undefined`. Itens de lista herdam o prefixo do pai (sem índice), de
    modo que os cem itens de um carrinho não viram cem achados da mesma chave.
    """
    entradas: List[Tuple[str, Any]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else str(k)
            entradas.append((full, v))
            entradas.extend(_flatten_entries(v, full))
    elif isinstance(obj, list):
        for item in obj:
            entradas.extend(_flatten_entries(item, prefix))
    return entradas


def _chaves_do_texto_cru(raw: str) -> List[Tuple[str, Any]]:
    """Extrai `(chave, valor)` de um push que não pôde ser parseado.

    A versão anterior varria o snippet inteiro com `termo in raw_lower`, ou
    seja, casava termo dentro dos **valores** também: qualquer push contendo a
    palavra "organization" em qualquer posição virava exposição de RG. Aqui só
    o que ocupa posição de chave é considerado.

    O casamento sem chave (grupos 1 a 3 vazios) é um literal de texto que a
    expressão consumiu de propósito, para que a vírgula de dentro dele não
    fosse lida como separador de campo — ver `_CHAVE_CRUA_RE`.
    """
    entradas: List[Tuple[str, Any]] = []
    for m in _CHAVE_CRUA_RE.finditer(raw or ""):
        chave = m.group(1) or m.group(2) or m.group(3)
        if not chave:
            continue
        valor = m.group(4) if m.group(4) is not None else (
            m.group(5) if m.group(5) is not None else m.group(6)
        )
        entradas.append((chave, valor))
    return entradas


#: Substitui o valor de uma chave que este módulo classificou como dado
#: pessoal. Fica no lugar do valor, e não do par inteiro, para que o trecho
#: continue provando ONDE o dado estava — que é o papel da evidência.
_VALOR_REMOVIDO = "[valor removido]"


def _redige_valores_de_pii(texto: str, chaves: FrozenSet[str]) -> str:
    """Apaga o valor de toda chave de dado pessoal, pelo NOME da chave.

    `mascarar_texto` só reconhece o que tem forma conferível: CPF, CNPJ,
    cartão, e-mail e telefone formatado. Senha, RG, CEP, endereço, data de
    nascimento e nome de pessoa não têm padrão — são dado pessoal por causa da
    chave, não do valor — e por isso atravessavam o mascarador intactos e iam
    para `raw_data`, para o banco e para o PDF. Medido:
    `{senha:'MinhaSenh@123'}` era gravado inteiro pelo produto que audita
    vazamento de dado pessoal.

    Quem decide o que é chave de dado pessoal é `_candidato`, o mesmo juiz que
    emite o achado — para que a redação nunca fique atrás do catálogo. `chaves`
    acrescenta os nomes de folha que só o caminho completo revela (`user.name`
    é dado pessoal, mas o texto cru mostra apenas `name`).

    Redigir a mais é aceitável aqui e redigir a menos não: um valor que sobra é
    um dado do cliente gravado onde não devia; um valor a mais escondido custa
    contexto num trecho que continua apontando a chave e a posição.
    """
    if not texto:
        return texto

    partes: List[str] = []
    fim_anterior = 0
    for m in _CHAVE_CRUA_RE.finditer(texto):
        chave = m.group(1) or m.group(2) or m.group(3)
        if not chave:
            continue                     # literal de texto consumido de propósito
        if chave.lower() not in chaves and _candidato(chave) is None:
            continue
        grupo = next((g for g in (4, 5, 6) if m.group(g) is not None), None)
        if grupo is None:
            continue                     # objeto ou lista: não há literal a apagar
        partes.append(texto[fim_anterior:m.start(grupo)])
        partes.append(_VALOR_REMOVIDO)
        fim_anterior = m.end(grupo)

    partes.append(texto[fim_anterior:])
    return "".join(partes)


def _trecho_seguro(raw: str, chaves_de_pii: FrozenSet[str] = frozenset(),
                   limite: int = 120) -> str:
    """Redige, mascara e **só então** corta o trecho guardado como evidência.

    Sem esse tratamento, o achado "CPF no dataLayer" carregava o CPF junto para
    `raw_data` e para o banco — o produto viraria o vazamento que audita.

    São dois filtros porque são dois motivos de sigilo: `_redige_valores_de_pii`
    apaga pelo nome da chave (senha, RG, CEP, nome) e `mascarar_texto` apaga
    pela forma do valor (um CPF escrito dentro de `observacao`, que chave
    nenhuma denuncia). Um sozinho deixa metade passar.

    A ordem é o detalhe que importa: cortando antes, o valor que cai em cima do
    limite chega aos filtros pela metade, não casa mais com o padrão e passa
    inteiro. Foi assim que `cpf:'529.982.247-2` e `user_email:'joaodasilva@e`
    foram parar no trecho guardado.
    """
    seguro = _redige_valores_de_pii(raw or "", chaves_de_pii)
    seguro, _ = mascarar_texto(seguro)
    return seguro[:limite] + ("..." if len(seguro) > limite else "")


def _scan_keys_for_pii(keys: List[str]) -> List[tuple]:
    """Compatibilidade: casamento por segmento, sem o valor à disposição.

    Mantida porque o nome é antigo. Quem tem o valor deve usar `_avalia`.
    """
    encontrados = []
    for key in keys:
        veredito = _avalia(key, None)
        if veredito:
            encontrados.append((key, veredito[0]))
    return encontrados


def _flatten_keys(obj: Any, prefix: str = "") -> List[str]:
    """Compatibilidade: só os caminhos, sem os valores."""
    return [caminho for caminho, _ in _flatten_entries(obj, prefix)]


def audit_datalayer(html: str) -> List[DataLayerFinding]:
    findings: List[DataLayerFinding] = []
    #: chave -> achado já emitido. A mesma chave em dois pushes rende um
    #: achado só, mas se o segundo push for mais grave (valor observado onde
    #: antes havia variável), o achado é elevado no lugar — "o primeiro venceu"
    #: esconderia o CPF de verdade atrás da primeira ocorrência templatizada.
    pii_por_chave: Dict[str, DataLayerFinding] = {}

    def registra_pii(chave: str, gravidade: str, confianca: str,
                     motivo: str, trecho: str, parseado: bool) -> None:
        nota = ("" if parseado else
                " O objeto do push não pôde ser parseado, então a leitura da "
                "chave é aproximada.")
        descricao = (
            f"Chave de dado pessoal '{chave}' presente no dataLayer.push(): "
            f"{motivo}. Todo script carregado na página consegue ler esse "
            f"valor.{nota}"
        )
        existente = pii_por_chave.get(chave)
        if existente is None:
            achado = DataLayerFinding(
                type="pii_exposure",
                severity=gravidade,
                keys=[chave],
                snippet=trecho,
                description=descricao,
                confidence=confianca,
            )
            pii_por_chave[chave] = achado
            findings.append(achado)
            return
        # Eleva no lugar, preservando a posição do achado na lista. A confiança
        # entra na comparação porque a gravidade sozinha empata: o mesmo `cpf`
        # visto num push que não parseou (confiança baixa) e depois num push
        # com o valor validado sai como critical nos dois, e o laudo ficaria
        # com a leitura aproximada — dizendo "não pôde ser parseado" ao lado de
        # uma observação limpa que existe.
        if _posto(gravidade, confianca) > _posto(existente.severity, existente.confidence):
            existente.severity = gravidade
            existente.confidence = confianca
            existente.description = descricao
            existente.snippet = trecho

    for m in _DL_PUSH_RE.finditer(html):
        raw = m.group(1)
        parsed = _safe_parse(raw)

        if parsed:
            vereditos = [
                (chave, _avalia(chave, valor))
                for chave, valor in _flatten_entries(parsed)
            ]
            # As folhas dos caminhos que deram dado pessoal. `user.name` é PII
            # pelo caminho inteiro, mas no texto cru do push a chave aparece só
            # como `name` — sem esta lista o valor dela ficaria no trecho.
            # Calculado antes de emitir qualquer achado porque um trecho único
            # serve a todos os achados deste push, PII e ecommerce.
            chaves_de_pii = frozenset(
                chave.split(".")[-1].lower() for chave, ver in vereditos if ver
            )
            trecho = _trecho_seguro(raw, chaves_de_pii)

            for chave, veredito in vereditos:
                if veredito:
                    gravidade, confianca, motivo = veredito
                    registra_pii(chave, gravidade, confianca, motivo, trecho, True)

            # Check ecommerce.items structure (GA4 enhanced ecommerce)
            ecommerce = parsed.get("ecommerce")
            if isinstance(ecommerce, dict):
                items = ecommerce.get("items") or ecommerce.get("products")
                if items is None:
                    findings.append(DataLayerFinding(
                        type="ecommerce_malformed",
                        severity="high",
                        keys=list(ecommerce.keys()),
                        snippet=trecho,
                        description="ecommerce object detected in dataLayer.push() but 'items' array is missing. "
                                    "GA4 enhanced ecommerce requires an 'items' array.",
                        confidence=CONFIDENCE_HIGH,
                    ))
                elif isinstance(items, list) and items:
                    # Validate first item structure
                    first = items[0] if isinstance(items[0], dict) else {}
                    required_item_keys = {"item_id", "item_name"}
                    present = {k.lower() for k in first.keys()}
                    missing = required_item_keys - present
                    if missing:
                        findings.append(DataLayerFinding(
                            type="ecommerce_malformed",
                            severity="medium",
                            keys=list(missing),
                            snippet=trecho,
                            description=f"ecommerce.items detected but items are missing required fields: "
                                        f"{', '.join(missing)}.",
                            confidence=CONFIDENCE_MEDIUM,
                        ))
        else:
            # Não parseou: lê só o que ocupa posição de chave e marca a
            # confiança como baixa. A severidade não é rebaixada de novo —
            # a incerteza já está declarada no campo de confiança.
            vereditos = [
                (chave, _avalia(chave, valor))
                for chave, valor in _chaves_do_texto_cru(raw)
            ]
            chaves_de_pii = frozenset(
                chave.split(".")[-1].lower() for chave, ver in vereditos if ver
            )
            trecho = _trecho_seguro(raw, chaves_de_pii)

            for chave, veredito in vereditos:
                if veredito:
                    gravidade, _confianca, motivo = veredito
                    registra_pii(chave, gravidade, CONFIDENCE_LOW, motivo, trecho, False)

    # Check for dataLayer re-initialization (overwrite risk)
    init_matches = list(_DL_INIT_RE.finditer(html))
    if len(init_matches) > 1:
        findings.append(DataLayerFinding(
            type="init_order_issue",
            severity="high",
            keys=[],
            snippet=f"window.dataLayer = [] appears {len(init_matches)} times",
            description=f"window.dataLayer = [] is assigned {len(init_matches)} times in the source. "
                        "Reassigning the array after GTM loads discards previously pushed data.",
            confidence=CONFIDENCE_HIGH,
        ))

    return findings

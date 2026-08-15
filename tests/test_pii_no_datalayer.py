"""O casamento de PII no dataLayer não pode ser por substring solta.

`_scan_keys_for_pii` perguntava `if termo in chave.lower()`. Contra um
`dataLayer.push` corriqueiro de e-commerce isso rendia quatro acusações de
exposição de dado pessoal, todas com `confidence=high`:

    "rg"   dentro de o**rg**anization      -> critical
    "cep"  dentro de ac**cep**ted          -> high
    "name" dentro de item_name, page_name  -> medium
    "uid"  dentro de u**uid**              -> medium

`pii_exposure` é o tipo que o veredito trata como o achado mais grave de
todos, acima de tudo. Um `item_name` de camiseta abria o laudo com a acusação
mais pesada que o produto sabe fazer.

Os testes vêm em dois blocos, e os dois lados importam igualmente:

- `TestFalsoPositivo`  — o que **não** pode mais aparecer.
- `TestPIIDeVerdade`   — o que **continua** aparecendo. Sem este bloco, a
  correção mais fácil (esvaziar o catálogo) passaria: comprar silêncio é a
  forma mais barata de zerar falso positivo, e a mais cara no laudo.
"""
import pytest

from audit_engine.datalayer_auditor import audit_datalayer


def _push(corpo: str) -> str:
    return f"<script>dataLayer.push({corpo});</script>"


def _pii(html: str):
    return [f for f in audit_datalayer(html) if f.type == "pii_exposure"]


def _chaves(html: str):
    return {c for f in _pii(html) for c in f.keys}


#: O push que abriu o caso: e-commerce de manual, sem uma linha de dado
#: pessoal. Antes da correção rendia organization/cookie_accepted/uuid/
#: item_name.
PUSH_ECOMMERCE = _push(
    "{event:'view_item', organization:'Acme', cookie_accepted:true, "
    "uuid:'abc-123', page_name:'Vitrine', "
    "ecommerce:{items:[{item_id:'SKU1', item_name:'Camiseta'}]}}"
)


class TestFalsoPositivo:
    def test_o_push_de_ecommerce_nao_acusa_dado_pessoal(self):
        assert _pii(PUSH_ECOMMERCE) == []

    @pytest.mark.parametrize("chave, termo_que_casava", [
        ("organization", "rg"),
        ("pergunta", "rg"),
        ("target_group", "rg"),
        ("cookie_accepted", "cep"),
        ("exception_type", "cep"),
        ("uuid", "uid"),
        ("guid", "uid"),
        ("item_name", "name"),
        ("page_name", "name"),
        ("event_name", "name"),
        ("category_name", "name"),
        # Colisões que a tolerância a prefixo/sufixo reabriria se fosse geral:
        ("smartphone", "phone"),
        ("headphone_model", "phone"),
        ("birthstone", "birth"),
        ("gift_card", "card_number"),
        ("nomenclatura", "nome"),
    ])
    def test_chave_comum_nao_vira_dado_pessoal(self, chave, termo_que_casava):
        html = _push("{event:'x', %s:'v'}" % chave)
        assert _pii(html) == [], (
            f"'{chave}' voltou a casar com o termo '{termo_que_casava}'"
        )

    def test_o_valor_nao_e_lido_como_chave_quando_o_push_nao_parseia(self):
        """Só o que ocupa posição de chave conta.

        A varredura antiga do fallback rodava `termo in raw.lower()` sobre o
        snippet inteiro, valores inclusive: qualquer push com a palavra
        "organization" em qualquer posição virava exposição de RG.
        """
        html = _push("{event:'view', label:'organization chart', v: fn()}")
        assert _pii(html) == []

    def test_user_id_nao_e_tratado_como_pii_grave(self):
        """`user_id` é campo recomendado do GA4, não identidade exposta.

        Ele fica no catálogo porque identificador vinculável é dado pessoal sob
        a LGPD, mas em gravidade baixa — instrumentação correta não pode virar
        a acusação mais pesada do laudo.
        """
        achados = _pii(_push("{event:'login', user_id:'8471'}"))
        assert [f.severity for f in achados] == ["low"]


class TestPIIDeVerdade:
    @pytest.mark.parametrize("chave", [
        "cpf", "user_email", "telefone", "data_nascimento",
        "senha", "first_name", "sobrenome", "cep", "rg",
    ])
    def test_continua_sendo_detectada(self, chave):
        html = _push("{event:'cadastro', %s:'x'}" % chave)
        assert chave in _chaves(html), f"'{chave}' deixou de ser detectada"

    @pytest.mark.parametrize("chave", [
        "userCPF",          # camelCase + sigla maiúscula
        "customerEmail",    # camelCase
        "e-mail",           # kebab-case
        "first-name",       # kebab-case composto
        "emails",           # plural, via tolerância de sufixo
    ])
    def test_a_quebra_em_segmentos_alcanca_as_variacoes_de_escrita(self, chave):
        html = _push("{event:'cadastro', '%s':'x'}" % chave)
        assert _chaves(html), f"'{chave}' não foi alcançada pela segmentação"

    def test_pii_aninhada_no_ecommerce_e_alcancada(self):
        html = _push(
            "{event:'purchase', ecommerce:{items:[{item_id:'SKU1'}]}, "
            "usuario:{cpf:'529.982.247-25'}}"
        )
        assert any("cpf" in c for c in _chaves(html))

    def test_o_push_nao_parseavel_ainda_acusa_a_chave(self):
        html = _push("{event:'cadastro', cpf: pegaCPF(), n: f()}")
        achados = _pii(html)
        assert [f.keys for f in achados] == [["cpf"]]
        assert achados[0].confidence == "low", (
            "push que não parseou precisa declarar confiança baixa"
        )


class TestOValorPesaNaGravidade:
    """Chave `cpf` com dígito verificador válido é evidência; sem, é indício."""

    def test_valor_validado_sai_com_confianca_alta(self):
        html = _push("{event:'purchase', cpf:'529.982.247-25'}")
        achado = _pii(html)[0]
        assert achado.severity == "critical"
        assert achado.confidence == "high"

    def test_valor_com_formato_errado_e_rebaixado(self):
        html = _push("{event:'purchase', cpf:'123'}")
        achado = _pii(html)[0]
        assert achado.severity == "high", "esperado um degrau abaixo de critical"
        assert achado.confidence == "medium"

    def test_valor_nao_observado_mantem_a_gravidade_e_baixa_a_confianca(self):
        """Não ver o valor não é motivo para rebaixar — é motivo para dizer."""
        html = _push("{event:'cadastro', user_email:''}")
        achado = _pii(html)[0]
        assert achado.severity == "critical"
        assert achado.confidence == "medium"
        assert "não foi observado" in achado.description

    def test_email_valido_sai_com_confianca_alta(self):
        html = _push("{event:'cadastro', user_email:'joao@exemplo.com.br'}")
        achado = _pii(html)[0]
        assert achado.confidence == "high"

    def test_a_mesma_chave_e_elevada_quando_o_segundo_push_traz_o_valor(self):
        """Dedup não pode esconder o CPF de verdade atrás da primeira leitura.

        O push templatizado costuma vir antes do push preenchido. Com
        "o primeiro vence", o laudo reportaria só a leitura mais branda.
        """
        html = (
            _push("{event:'inicio', cpf:'123'}")
            + _push("{event:'purchase', cpf:'529.982.247-25'}")
        )
        achados = _pii(html)
        assert len(achados) == 1, "a mesma chave não pode render dois achados"
        assert achados[0].severity == "critical"
        assert achados[0].confidence == "high"


class TestOTrechoGuardadoNaoCarregaOValor:
    """O laudo aponta o local, nunca o conteúdo.

    `snippet` vai para `raw_data` e daí para o banco. Guardar o push cru de um
    checkout fazia o produto gravar o CPF e o e-mail do comprador — virava o
    vazamento que ele audita.
    """

    def test_o_cpf_nao_aparece_no_trecho(self):
        html = _push("{event:'purchase', cpf:'529.982.247-25'}")
        trechos = " ".join(f.snippet or "" for f in audit_datalayer(html))
        assert "529.982.247-25" not in trechos
        assert "529982247" not in trechos

    def test_o_email_nao_aparece_no_trecho(self):
        html = _push("{event:'cadastro', user_email:'joao@exemplo.com.br'}")
        trechos = " ".join(f.snippet or "" for f in audit_datalayer(html))
        assert "joao@exemplo.com.br" not in trechos


class TestOTrechoTambemApagaOQueNaoTemFormato:
    """Mascarar só pelo formato do valor deixava metade do vazamento passar.

    `mascarar_texto` reconhece CPF, CNPJ, cartão, e-mail e telefone formatado —
    coisas com padrão. Senha, RG, CEP, endereço, data de nascimento e nome de
    pessoa não têm padrão nenhum: são dado pessoal por causa da CHAVE. Elas
    atravessavam o mascarador intactas e iam para `snippet`, `raw_data`, banco e
    PDF. Medido antes da correção: `{senha:'MinhaSenh@123'}` era gravado
    inteiro pelo produto que audita vazamento de dado pessoal.

    A redação usa `_candidato`, o mesmo juiz que emite o achado, para que ela
    nunca fique atrás do catálogo.
    """

    @pytest.mark.parametrize("chave,valor", [
        ("senha", "MinhaSenh@123"),
        ("password", "hunter2"),
        ("rg", "12.345.678-9"),
        ("cep", "01310-100"),
        ("address", "Rua Augusta 100 ap 42"),
        ("first_name", "Joao"),
        ("birthdate", "1990-01-15"),
        ("nome_completo", "Joao da Silva"),
    ])
    def test_o_valor_da_chave_de_pii_nao_e_guardado(self, chave, valor):
        html = _push("{event:'checkout', %s:'%s'}" % (chave, valor))
        achados = _pii(html)
        assert achados, f"'{chave}' deixou de ser detectada — o teste perdeu o alvo"
        trechos = " ".join(f.snippet or "" for f in achados)
        assert valor not in trechos, f"valor de '{chave}' gravado no trecho: {trechos!r}"
        assert chave in trechos, (
            "a chave precisa continuar no trecho: a evidência é ONDE o dado "
            f"estava, e ela sumiu — {trechos!r}"
        )

    def test_nome_aninhado_tambem_e_apagado(self):
        """`user.name` é dado pessoal pelo caminho inteiro; no texto cru do push
        a chave aparece só como `name`, e era por aí que o valor escapava."""
        html = _push("{user:{name:'Joao da Silva'}, item_name:'Camiseta'}")
        trechos = " ".join(f.snippet or "" for f in _pii(html))
        assert "Joao da Silva" not in trechos, f"nome gravado no trecho: {trechos!r}"

    def test_valor_que_nao_e_pii_continua_visivel(self):
        """Apagar tudo seria a correção preguiçosa: o trecho existe para
        mostrar o contexto em que o dado pessoal apareceu."""
        html = _push("{event:'purchase', transaction_id:'PED-9931', cpf:'529.982.247-25'}")
        trechos = " ".join(f.snippet or "" for f in _pii(html))
        assert "PED-9931" in trechos, f"o contexto do push foi apagado junto: {trechos!r}"
        assert "purchase" in trechos


class TestOCorteDoTrechoNaoBurlaOMascaramento:
    """Mascarar depois de cortar deixa o valor partido escapar inteiro.

    O trecho era cortado em 120 caracteres e só então mascarado. Um valor que
    caísse em cima do limite chegava pela metade ao mascarador, não casava mais
    com o padrão e passava intacto: `cpf:'529.982.247-2` e
    `user_email:'joaodasilva@e` foram gravados assim em `raw_data`.

    O laço cobre a faixa inteira de posições justamente porque o defeito só
    aparece quando o valor cruza a borda — um caso único passaria por sorte.
    """

    @pytest.mark.parametrize("enchimento", range(60, 110, 7))
    def test_o_cpf_nao_vaza_quando_cai_em_cima_do_corte(self, enchimento):
        html = _push(
            "{event:'compra', a:'%s', cpf:'529.982.247-25'}" % ("x" * enchimento)
        )
        trechos = " ".join(f.snippet or "" for f in audit_datalayer(html))
        assert "529" not in trechos, f"CPF vazou no trecho: {trechos!r}"

    @pytest.mark.parametrize("enchimento", range(60, 110, 7))
    def test_o_email_nao_vaza_quando_cai_em_cima_do_corte(self, enchimento):
        html = _push(
            "{event:'cadastro', a:'%s', user_email:'joaodasilva@empresa.com.br'}"
            % ("x" * enchimento)
        )
        trechos = " ".join(f.snippet or "" for f in audit_datalayer(html))
        assert "joaodasilva" not in trechos, f"e-mail vazou: {trechos!r}"
        assert "joaodasi" not in trechos, f"e-mail vazou pela metade: {trechos!r}"


class TestNaoNegarOQueNaoDaParaConferir:
    """Rebaixar por ausência de formato só vale com validador conclusivo.

    `mascarador._TELEFONE` recusa número sem formatação de propósito, para não
    estragar o `cid` do GA4. Usar essa recusa como prova fazia o laudo afirmar
    "o valor observado não tem esse formato" sobre `phone:'11987654321'` — um
    celular de São Paulo — e ainda rebaixar o achado.
    """

    def test_telefone_sem_formatacao_nao_e_desmentido(self):
        achado = _pii(_push("{event:'lead', phone:'11987654321'}"))[0]
        assert achado.severity == "high", "telefone cru não pode ser rebaixado"
        assert "não passou na validação" not in achado.description
        assert "não pôde ser conferido" in achado.description

    def test_telefone_formatado_continua_confirmado(self):
        achado = _pii(_push("{event:'lead', phone:'(11) 98765-4321'}"))[0]
        assert achado.severity == "high"
        assert achado.confidence == "high"

    def test_cpf_invalido_continua_rebaixado(self):
        """CPF tem dígito verificador: aqui a ausência é conclusiva mesmo."""
        achado = _pii(_push("{event:'compra', cpf:'123'}"))[0]
        assert achado.severity == "high"
        assert achado.confidence == "medium"


class TestValorDeModeloNaoEValorObservado:
    """`{{DLV - CPF}}` é o container do GTM, não o CPF de ninguém."""

    @pytest.mark.parametrize("modelo", [
        "{{DLV - CPF}}", "${cpf}", "<%= @cpf %>", "%%CPF%%", "undefined",
    ])
    def test_o_modelo_nao_e_conferido_contra_o_formato(self, modelo):
        achado = _pii(_push("{event:'compra', cpf:'%s'}" % modelo))[0]
        assert achado.severity == "critical", (
            "valor não observado não rebaixa o achado — só a confiança cai"
        )
        assert achado.confidence == "medium"
        assert "não foi observado" in achado.description


class TestHashNaoEDadoEmTextoClaro:
    """O laudo recomenda hashear; então não pode chamar hash de texto claro.

    O achado continua — hash de e-mail é dado pessoal pseudonimizado sob a
    LGPD —, mas a frase precisa dizer o que a varredura viu.
    """

    def test_email_hasheado_nao_sai_como_texto_claro(self):
        # Montado por repetição para o tamanho ser exato: 64 hexadecimais.
        sha256 = "ab" * 32
        achado = _pii(_push("{event:'cadastro', user_email:'%s'}" % sha256))[0]
        assert achado.severity == "high", "hash não é exposição em texto claro"
        assert "hexadecimais" in achado.description
        assert "texto claro" in achado.description

    def test_email_em_claro_continua_critico(self):
        """O contrapeso: rebaixar hash não pode rebaixar o dado de verdade."""
        achado = _pii(_push("{event:'cadastro', user_email:'joao@exemplo.com.br'}"))[0]
        assert achado.severity == "critical"
        assert achado.confidence == "high"


class TestNomeDePessoaContinuaSendoDetectado:
    """A lista fechada de pares comprou silêncio, e silêncio também mente.

    Tirar `name` do catálogo resolveu `item_name`; trocá-lo por uma enumeração
    (`first_name`, `last_name`, …) deixou de fora campo de checkout que a
    versão por substring pegava. Todos os casos abaixo são nome de pessoa.
    """

    @pytest.mark.parametrize("chave", [
        "middle_name",
        "surname",
        "billing_name",
        "shipping_name",
        "cardholder_name",
        "card_holder_name",
        "name_on_card",
        "recipient_name",
        "member_name",
        "nome_do_titular",
        "first_name",
        "customerName",
    ])
    def test_nome_qualificado_e_detectado(self, chave):
        html = _push("{event:'checkout', '%s':'Joao da Silva'}" % chave)
        assert _chaves(html), f"'{chave}' deixou de ser detectada"

    @pytest.mark.parametrize("chave", [
        "item_name",
        "item_list_name",
        "promotion_name",
        "creative_name",
        "product_name",
        "brand_name",
        "store_name",
        "campaign_name",
        "file_name",
        "event_name",
        "page_name",
        # Parâmetro padrão do GA4 para aplicativo: nomeia a tela, não a pessoa.
        "screen_name",
    ])
    def test_nome_de_coisa_continua_fora_do_laudo(self, chave):
        html = _push("{event:'view_item', '%s':'Camiseta'}" % chave)
        assert _pii(html) == [], f"'{chave}' voltou a virar dado pessoal"


class TestTextoDentroDeValorNaoViraChave:
    """O fallback do push não parseado ainda lia dentro de string.

    A vírgula de dentro de um literal era lida como separador de campo, e o que
    vinha depois virava chave: `tags:['promo, senha: 1']` rendia um achado
    `senha` **critical** que nunca esteve no push. É a mesma família do defeito
    original — termo casado dentro do valor.
    """

    def test_a_virgula_dentro_da_string_nao_abre_campo_novo(self):
        html = _push("{event:'x', tags:['promo, senha: 1'], v: fn()}")
        assert _pii(html) == []

    def test_chave_de_verdade_no_mesmo_push_continua_saindo(self):
        """O contrapeso: consumir o literal não pode calar a chave ao lado."""
        html = _push("{event:'x', tags:['promo, senha: 1'], cpf: pegaCPF()}")
        assert _chaves(html) == {"cpf"}


class TestALeituraLimpaSubstituiAAproximada:
    """Empate de gravidade não pode deixar o laudo com a leitura mais fraca.

    O push templatizado costuma vir antes do preenchido. Com a comparação só
    por gravidade, o `cpf` visto num push que não parseou (confiança baixa) e
    depois num push com o valor validado ficava com a leitura aproximada — e a
    frase "não pôde ser parseado" ao lado de uma observação limpa que existe.
    """

    def test_a_confianca_sobe_quando_o_segundo_push_parseia(self):
        html = (
            _push("{event:'inicio', cpf: pegaCPF(), z: f()}")
            + _push("{event:'purchase', cpf:'529.982.247-25'}")
        )
        achados = _pii(html)
        assert len(achados) == 1
        assert achados[0].severity == "critical"
        assert achados[0].confidence == "high"
        assert "não pôde ser parseado" not in achados[0].description


class TestOsOutrosAchadosSobrevivem:
    """A correção mexe só no bloco de PII."""

    def test_ecommerce_sem_items_continua_apontado(self):
        html = _push("{event:'purchase', ecommerce:{currency:'BRL', value:10}}")
        assert any(f.type == "ecommerce_malformed" for f in audit_datalayer(html))

    def test_datalayer_reinicializado_continua_apontado(self):
        html = "<script>window.dataLayer = [];</script><script>window.dataLayer = [];</script>"
        assert any(f.type == "init_order_issue" for f in audit_datalayer(html))

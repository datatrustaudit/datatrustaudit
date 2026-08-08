"""audit_engine.guia_de_correcao — o que fazer com cada achado, em português.

Apontar o problema é a parte fácil. O que separa um laudo útil de uma lista de
reclamações é dizer, sem rodeio: onde está, por que importa, o que digitar para
corrigir e como confirmar que ficou resolvido.

Cada guia responde cinco perguntas, na ordem em que quem vai corrigir precisa:

    o_que_esta_errado  — em uma frase, sem jargão
    por_que_importa    — consequência prática e jurídica
    como_corrigir      — passo a passo numerado
    exemplo            — código pronto para copiar, quando aplicável
    como_verificar     — o teste que prova que a correção pegou

`base_legal` cita o artigo, mas o texto evita afirmar ilegalidade: o produto
entrega avaliação técnica, não parecer jurídico.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# Quanto de cada laudo o plano libera. Fonte única: o percentual estava
# repetido em api/audit.py, api/scans.py e main.py, e divergir aqui significa
# entregar conteúdo pago para quem não pagou (ou cortar de quem pagou).
VISIBILIDADE_POR_PLANO = {
    "free": 0.50,
    "pro": 0.75,
    "premium": 1.00,
    "admin": 1.00,
}


def visibilidade_do_plano(plano: str) -> float:
    return VISIBILIDADE_POR_PLANO.get(plano, VISIBILIDADE_POR_PLANO["free"])


def quantidade_visivel(total: int, plano: str) -> int:
    """Quantos itens de uma lista o plano enxerga. Sempre ao menos um."""
    if total <= 0:
        return 0
    if visibilidade_do_plano(plano) >= 1.0:
        return total
    return max(1, int(total * visibilidade_do_plano(plano)))


@dataclass
class GuiaDeCorrecao:
    o_que_esta_errado: str
    por_que_importa: str
    como_corrigir: List[str] = field(default_factory=list)
    exemplo: Optional[str] = None
    como_verificar: Optional[str] = None
    base_legal: Optional[str] = None
    esforco: str = "medio"          # baixo | medio | alto
    quem_resolve: str = "Tag Manager"  # quem costuma tocar nisso

    def to_dict(self) -> Dict[str, Any]:
        return {
            "whatIsWrong": self.o_que_esta_errado,
            "whyItMatters": self.por_que_importa,
            "howToFix": self.como_corrigir,
            "codeExample": self.exemplo,
            "howToVerify": self.como_verificar,
            "legalBasis": self.base_legal,
            "effort": self.esforco,
            "ownedBy": self.quem_resolve,
        }


GUIAS: Dict[str, GuiaDeCorrecao] = {

    # ── Consentimento ────────────────────────────────────────────────────────
    "tracking_after_rejection": GuiaDeCorrecao(
        o_que_esta_errado=(
            "O visitante clicou em recusar e as tags continuaram coletando dados."
        ),
        por_que_importa=(
            "É a situação mais grave que uma auditoria encontra. Não é configuração "
            "imperfeita: a pessoa manifestou recusa e a coleta seguiu. Diante da ANPD, "
            "a diferença entre 'não bloqueamos direito' e 'ignoramos a recusa' é enorme, "
            "e o registro técnico dessa segunda situação é difícil de contestar."
        ),
        como_corrigir=[
            "No GTM, abra cada tag de analytics e publicidade listada no laudo.",
            "Em 'Configurações avançadas' > 'Consent Settings', marque os consentimentos "
            "adicionais exigidos (analytics_storage para GA4, ad_storage para as de mídia).",
            "Confirme que a CMP escreve o estado de consentimento ANTES do container do GTM.",
            "Se a tag estiver no código-fonte e não no GTM, mova-a para o GTM — só assim o "
            "bloqueio por consentimento passa a valer para ela.",
            "Publique o container e repita a auditoria.",
        ],
        exemplo=(
            "<!-- No <head>, ANTES do GTM: estado padrão negado -->\n"
            "<script>\n"
            "  window.dataLayer = window.dataLayer || [];\n"
            "  function gtag(){dataLayer.push(arguments);}\n"
            "  gtag('consent', 'default', {\n"
            "    ad_storage: 'denied',\n"
            "    ad_user_data: 'denied',\n"
            "    ad_personalization: 'denied',\n"
            "    analytics_storage: 'denied',\n"
            "    wait_for_update: 500\n"
            "  });\n"
            "</script>"
        ),
        como_verificar=(
            "Abra o site em aba anônima, clique em recusar e veja a aba Network do "
            "navegador: não deve haver requisição para google-analytics.com/g/collect "
            "nem facebook.com/tr depois do clique."
        ),
        base_legal="LGPD art. 8º, §5º — o consentimento pode ser revogado a qualquer momento",
        esforco="medio",
        quem_resolve="Tag Manager + CMP",
    ),

    "no_reject_option": GuiaDeCorrecao(
        o_que_esta_errado=(
            "O aviso de cookies só oferece o botão de aceitar; não há como recusar."
        ),
        por_que_importa=(
            "Consentimento só vale se for livre. Quando o único caminho para seguir "
            "navegando é concordar, não há escolha — há obstáculo. Recusar precisa ser "
            "tão fácil quanto aceitar: mesmo nível, mesma tela, destaque equivalente."
        ),
        como_corrigir=[
            "Abra as configurações do seu banner de consentimento.",
            "Ative o botão 'Recusar tudo' (ou 'Apenas necessários') no primeiro nível — "
            "não escondido atrás de 'Preferências'.",
            "Dê a ele o mesmo tamanho, cor de contraste e posição do botão de aceitar.",
            "Evite pré-marcar categorias opcionais: caixa marcada por padrão não é consentimento.",
        ],
        como_verificar=(
            "Abra o site em aba anônima. Os dois botões devem estar visíveis na mesma "
            "tela, sem precisar rolar nem abrir outro menu."
        ),
        base_legal="LGPD art. 5º, XII — consentimento livre, informado e inequívoco",
        esforco="baixo",
        quem_resolve="CMP",
    ),

    "cmp_present_no_ui": GuiaDeCorrecao(
        o_que_esta_errado=(
            "A ferramenta de consentimento está instalada, mas nenhum aviso aparece "
            "para o visitante."
        ),
        por_que_importa=(
            "É pior do que não ter CMP nenhuma: a equipe acredita estar em conformidade, "
            "o custo da licença está sendo pago, e na prática ninguém nunca foi consultado. "
            "A causa quase sempre é a mesma — o banner ficou restrito à União Europeia, "
            "configuração padrão de várias plataformas."
        ),
        como_corrigir=[
            "No painel da sua CMP, procure a configuração de região ou geo-targeting.",
            "Inclua o Brasil (ou 'todos os países') na lista de exibição do banner.",
            "Se a CMP não permitir escopo por região, ative a exibição global.",
            "Confirme que o script da CMP carrega em todas as páginas, não só na home.",
        ],
        como_verificar=(
            "Abra o site em aba anônima, a partir de um IP brasileiro. O aviso precisa "
            "aparecer na primeira visita, antes de qualquer interação."
        ),
        base_legal="LGPD art. 9º — o titular tem direito ao acesso facilitado à informação",
        esforco="baixo",
        quem_resolve="CMP",
    ),

    "no_consent_control": GuiaDeCorrecao(
        o_que_esta_errado="O site não oferece nenhum controle de consentimento.",
        por_que_importa=(
            "Sem mecanismo de consentimento, toda coleta feita por analytics e "
            "publicidade acontece sem base legal declarada. É o cenário de maior "
            "exposição, e o mais simples de resolver."
        ),
        como_corrigir=[
            "Escolha uma CMP (Cookiebot, OneTrust, Didomi e Usercentrics são as mais usadas).",
            "Instale o script da CMP como o PRIMEIRO elemento do <head>, antes de GTM e tags.",
            "Configure o Consent Mode v2 com todos os sinais em 'denied' por padrão.",
            "Condicione o disparo das tags ao consentimento, pelo GTM.",
            "Publique e audite de novo para confirmar o bloqueio.",
        ],
        base_legal="LGPD art. 7º, I — o tratamento depende de consentimento do titular",
        esforco="alto",
        quem_resolve="CMP + Tag Manager",
    ),

    # ── Cookies e armazenamento ──────────────────────────────────────────────
    "storage_without_consent": GuiaDeCorrecao(
        o_que_esta_errado=(
            "Cookies de rastreamento foram gravados no navegador antes de qualquer aceite."
        ),
        por_que_importa=(
            "Cookie gravado é evidência direta e datada: diferente de inferir ordem pelo "
            "código, aqui o dado já está no navegador do visitante. Vários desses "
            "identificadores duram 400 dias, o que transforma uma visita única em "
            "rastreamento de longo prazo."
        ),
        como_corrigir=[
            "Identifique qual tag grava cada cookie apontado no laudo.",
            "Mova essas tags para o GTM, se ainda estiverem no código-fonte.",
            "Condicione o disparo ao consentimento, com o Consent Mode.",
            "Revise o prazo de expiração: conservação além do necessário exige justificativa.",
            "Se usa Cookiebot ou OneTrust, ative o bloqueio automático de scripts.",
        ],
        como_verificar=(
            "Aba anônima > F12 > Application > Cookies. Antes de qualquer clique, só "
            "devem existir cookies estritamente necessários (sessão, carrinho, idioma)."
        ),
        base_legal="LGPD art. 7º e art. 16 — necessidade e prazo de conservação",
        esforco="medio",
        quem_resolve="Tag Manager + CMP",
    ),

    # ── Consent Mode ─────────────────────────────────────────────────────────
    "consent_default_after_config": GuiaDeCorrecao(
        o_que_esta_errado=(
            "O gtag('consent','default') está declarado DEPOIS do gtag('config')."
        ),
        por_que_importa=(
            "Nessa ordem o Consent Mode não protege nada: quando o estado padrão chega, "
            "a tag do Google já inicializou e coletou. O erro é invisível para quem só "
            "verifica se o Consent Mode 'está instalado' — ele está, e não funciona."
        ),
        como_corrigir=[
            "Localize o bloco gtag('consent','default',{...}) no código.",
            "Mova-o para ANTES de qualquer chamada gtag('config',...).",
            "O ideal é que seja o primeiro script do <head>, antes até do GTM.",
            "Mantenha wait_for_update em 500ms para dar tempo à CMP de responder.",
        ],
        exemplo=(
            "<!-- ORDEM CORRETA -->\n"
            "<script>\n"
            "  window.dataLayer = window.dataLayer || [];\n"
            "  function gtag(){dataLayer.push(arguments);}\n"
            "  gtag('consent','default',{ analytics_storage:'denied', ad_storage:'denied',\n"
            "                             ad_user_data:'denied', ad_personalization:'denied',\n"
            "                             wait_for_update:500 });\n"
            "</script>\n"
            "<!-- só DEPOIS o GTM / gtag config -->\n"
            "<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-XXXXXXX\"></script>\n"
            "<script>gtag('js', new Date()); gtag('config','G-XXXXXXX');</script>"
        ),
        como_verificar=(
            "No console: dataLayer[0] deve ser o comando de consent default. Se for o "
            "config, a ordem ainda está trocada."
        ),
        esforco="baixo",
        quem_resolve="Desenvolvimento",
    ),

    "consent_mode_missing": GuiaDeCorrecao(
        o_que_esta_errado="Há produtos do Google no site, mas o Consent Mode v2 não está configurado.",
        por_que_importa=(
            "Desde 2024 o Google exige o Consent Mode v2 para tráfego do Espaço Econômico "
            "Europeu. Sem ele, campanhas perdem dados de conversão e públicos de "
            "remarketing deixam de ser alimentados — o prejuízo é de mídia, não só de "
            "conformidade."
        ),
        como_corrigir=[
            "Implemente gtag('consent','default',{...}) com os quatro sinais em 'denied'.",
            "Configure sua CMP para chamar gtag('consent','update',{...}) quando o "
            "visitante decidir.",
            "Os quatro sinais obrigatórios: ad_storage, ad_user_data, ad_personalization "
            "e analytics_storage.",
            "Se usa CMP certificada pelo Google, ative a integração nativa com Consent Mode.",
        ],
        base_legal="Política de Consentimento do Usuário da UE (Google)",
        esforco="medio",
        quem_resolve="Tag Manager",
    ),

    # ── Ordem e estrutura ────────────────────────────────────────────────────
    "datalayer_after_gtm": GuiaDeCorrecao(
        o_que_esta_errado="O dataLayer é inicializado depois do container do GTM.",
        por_que_importa=(
            "Os eventos empilhados antes da inicialização se perdem. Costuma aparecer "
            "como conversão faltando no relatório sem explicação — o evento disparou, "
            "mas ninguém estava ouvindo ainda."
        ),
        como_corrigir=[
            "Declare window.dataLayer = window.dataLayer || []; antes do snippet do GTM.",
            "Todo dataLayer.push de dados de página (usuário, produto, categoria) deve vir "
            "antes do container também.",
        ],
        exemplo=(
            "<script>\n"
            "  window.dataLayer = window.dataLayer || [];\n"
            "  dataLayer.push({ pagina: 'produto', categoria: 'eletronicos' });\n"
            "</script>\n"
            "<!-- só agora o container -->\n"
            "<script>(function(w,d,s,l,i){/* GTM */})(window,document,'script','dataLayer','GTM-XXXXXXX');</script>"
        ),
        esforco="baixo",
        quem_resolve="Desenvolvimento",
    ),

    # ── Qualidade de dados ───────────────────────────────────────────────────
    "duplicate_tag": GuiaDeCorrecao(
        o_que_esta_errado="A mesma ferramenta está instalada mais de uma vez na página.",
        por_que_importa=(
            "Cada instalação dispara a própria coleta: sessões contadas em dobro, taxa de "
            "rejeição irreal e, quando atinge eventos de compra, receita inflada no "
            "relatório. Decisão de mídia tomada sobre número dobrado custa caro."
        ),
        como_corrigir=[
            "Verifique se a tag está hardcoded no tema E também no GTM — é a causa mais comum.",
            "Escolha um único ponto de instalação: preferencialmente o GTM.",
            "Remova a versão hardcoded do código-fonte.",
            "Se forem contas diferentes (dois IDs), confirme se a duplicidade é intencional.",
        ],
        como_verificar=(
            "Com a extensão Google Tag Assistant ou na aba Network: deve haver uma única "
            "requisição de configuração por ferramenta no carregamento."
        ),
        esforco="baixo",
        quem_resolve="Tag Manager",
    ),

    "obsolete_ua": GuiaDeCorrecao(
        o_que_esta_errado="O site ainda carrega o Universal Analytics, descontinuado em 2023.",
        por_que_importa=(
            "Não recebe mais dados: o que estiver sendo coletado por ele está sendo "
            "descartado. Além disso é código sem manutenção rodando no site, e não "
            "suporta Consent Mode — então nem entra na sua estratégia de consentimento."
        ),
        como_corrigir=[
            "Remova analytics.js e todas as chamadas ga('create', 'UA-...').",
            "Confirme que o GA4 já está coletando (Relatórios > Tempo real).",
            "No GTM, pause e depois exclua as tags de Universal Analytics.",
        ],
        esforco="baixo",
        quem_resolve="Tag Manager",
    ),

    "pii_exposure": GuiaDeCorrecao(
        o_que_esta_errado="Há dado pessoal identificável trafegando no dataLayer.",
        por_que_importa=(
            "E-mail, CPF ou telefone em texto claro no dataLayer ficam acessíveis a "
            "qualquer script da página — inclusive de terceiros — e seguem para as "
            "ferramentas de analytics, o que viola os termos de uso do próprio Google e "
            "amplia muito a superfície de um eventual incidente."
        ),
        como_corrigir=[
            "Remova os campos com dado pessoal do dataLayer.",
            "Se precisar de correspondência avançada, envie o valor com hash SHA-256, "
            "nunca em texto claro.",
            "Revise variáveis do GTM que leiam esses campos.",
            "Para Meta e Google Ads, use a correspondência avançada oficial, que já "
            "aplica hash no navegador.",
        ],
        exemplo=(
            "// ERRADO\n"
            "dataLayer.push({ email: 'cliente@exemplo.com.br', cpf: '000.000.000-00' });\n\n"
            "// CERTO — hash antes de enviar, e nunca CPF\n"
            "const emailHash = await sha256(email.trim().toLowerCase());\n"
            "dataLayer.push({ email_sha256: emailHash });"
        ),
        base_legal="LGPD art. 6º, VII — segurança; art. 46 — medidas de proteção",
        esforco="medio",
        quem_resolve="Desenvolvimento",
    ),
}


# Achados do motor que não têm chave própria caem no guia mais próximo.
_EQUIVALENCIAS = {
    "tracking_before_consent": "storage_without_consent",
    "critical_tracker": "storage_without_consent",
    "advertising_tracker": "storage_without_consent",
    "no_cmp": "no_consent_control",
    "rejection_respected": None,      # não é problema: nada a corrigir
}


def guia_para(chave: str) -> Optional[GuiaDeCorrecao]:
    """Guia de correção para o achado, ou None se não houver (ou se não for problema)."""
    if chave in GUIAS:
        return GUIAS[chave]
    equivalente = _EQUIVALENCIAS.get(chave)
    return GUIAS.get(equivalente) if equivalente else None

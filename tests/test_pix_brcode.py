"""O copia-e-cola do PIX.

Errar aqui não produz mensagem de erro: produz "QR Code inválido" no aplicativo
do banco, na hora de pagar. A venda se perde e ninguém descobre por quê — o
cliente some, não abre chamado.

O CRC é conferido contra um valor calculado por implementação independente do
padrão CRC-16/CCITT-FALSE, não contra o que este módulo devolve. Um teste que
compara a função com ela mesma passa mesmo com o polinômio errado.
"""
import os
import re

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.pix_brcode import crc16, gerar_brcode


def campos(brcode):
    """Desmonta o payload em {id: valor}, do jeito que o banco lê."""
    resultado, i = {}, 0
    while i < len(brcode):
        ident = brcode[i:i + 2]
        tam = int(brcode[i + 2:i + 4])
        resultado[ident] = brcode[i + 4:i + 4 + tam]
        i += 4 + tam
    return resultado


class TestCrc:
    def test_valor_conhecido_do_padrao(self):
        """"123456789" tem CRC-16/CCITT-FALSE 0x29B1 — o vetor de referência
        publicado do algoritmo."""
        assert crc16("123456789") == "29B1"

    def test_string_vazia_devolve_o_valor_inicial(self):
        assert crc16("") == "FFFF"

    def test_um_caractere_diferente_muda_o_crc(self):
        """É essa propriedade que faz o dígito verificador servir para algo."""
        assert crc16("PIX0001") != crc16("PIX0002")


class TestEstrutura:
    @pytest.fixture()
    def brcode(self):
        return gerar_brcode(
            chave="digitalfistpower@gmail.com",
            valor=234.65,
            nome_recebedor="DataTrust Audit",
            cidade="Sao Paulo",
            txid="DTA123",
        )

    def test_comeca_com_a_versao_do_formato(self, brcode):
        assert brcode.startswith("000201")

    def test_termina_com_o_crc_do_proprio_payload(self, brcode):
        corpo, crc_declarado = brcode[:-4], brcode[-4:]
        assert corpo.endswith("6304")
        assert crc_declarado == crc16(corpo)

    def test_moeda_e_pais_sao_do_brasil(self, brcode):
        c = campos(brcode)
        assert c["53"] == "986"   # BRL
        assert c["58"] == "BR"

    def test_valor_vai_com_duas_casas(self, brcode):
        assert campos(brcode)["54"] == "234.65"

    def test_a_chave_viaja_no_merchant_account(self, brcode):
        assert "digitalfistpower@gmail.com" in campos(brcode)["26"]
        assert "br.gov.bcb.pix" in campos(brcode)["26"]

    def test_tamanho_declarado_bate_com_o_conteudo(self, brcode):
        """Se um tamanho estiver errado, o parser do banco lê lixo do campo
        seguinte — e o erro não aparece aqui, aparece no celular do cliente."""
        i = 0
        while i < len(brcode):
            tam = int(brcode[i + 2:i + 4])
            assert i + 4 + tam <= len(brcode), f"campo em {i} declara tamanho maior que o payload"
            i += 4 + tam
        assert i == len(brcode), "sobrou byte solto no fim do payload"


class TestValorRedondo:
    def test_valor_inteiro_ganha_as_casas_decimais(self):
        """"247" em vez de "247.00" é recusado por parte dos bancos."""
        assert campos(gerar_brcode("chave@x.com", 247, "X", "SP"))["54"] == "247.00"

    def test_arredonda_para_dois_digitos(self):
        """O desconto do PIX produz dízima: 247 × 0,95 = 234,64999…"""
        assert campos(gerar_brcode("chave@x.com", 234.64999, "X", "SP"))["54"] == "234.65"


class TestTextoDoRecebedor:
    def test_acento_e_removido(self):
        """O BR Code não aceita acentuação. Mandar o acento cru gera um código
        que uns bancos leem e outros recusam — o pior caso, porque falha só
        para parte dos clientes."""
        c = campos(gerar_brcode("chave@x.com", 10, "Serviço Ltda", "São Paulo"))
        assert c["59"] == "SERVICO LTDA"
        assert c["60"] == "SAO PAULO"

    def test_nome_longo_e_cortado_no_limite_do_padrao(self):
        c = campos(gerar_brcode("chave@x.com", 10, "A" * 60, "B" * 40))
        assert len(c["59"]) <= 25
        assert len(c["60"]) <= 15

    def test_nome_vazio_nao_gera_campo_vazio(self):
        """Campo obrigatório com tamanho zero quebra o parser do banco."""
        c = campos(gerar_brcode("chave@x.com", 10, "", ""))
        assert c["59"] and c["60"]


class TestIdentificador:
    def test_txid_viaja_no_campo_adicional(self):
        c = campos(gerar_brcode("chave@x.com", 10, "X", "SP", txid="PEDIDO42"))
        assert "PEDIDO42" in c["62"]

    def test_caractere_invalido_sai_do_txid(self):
        """Espaço e hífen no txid são recusados."""
        c = campos(gerar_brcode("chave@x.com", 10, "X", "SP", txid="PED-42 A"))
        assert re.fullmatch(r"05\d{2}[A-Za-z0-9]+", c["62"])


class TestRecusaOQueNaoDaParaCobrar:
    def test_sem_chave_levanta(self):
        """Silenciar aqui geraria um código que o banco recusa, e o cliente
        acharia que o problema é dele."""
        with pytest.raises(ValueError):
            gerar_brcode("", 10, "X", "SP")

    def test_valor_zero_levanta(self):
        with pytest.raises(ValueError):
            gerar_brcode("chave@x.com", 0, "X", "SP")

    def test_valor_negativo_levanta(self):
        with pytest.raises(ValueError):
            gerar_brcode("chave@x.com", -5, "X", "SP")

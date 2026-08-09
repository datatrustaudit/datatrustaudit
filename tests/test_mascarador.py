"""Remoção de dado pessoal antes de o HAR entrar em casa.

Gravar um checkout captura e-mail, CPF e às vezes cartão. Se isso chegasse ao
nosso banco, o produto viraria o vazamento que audita.

Há dois modos de errar aqui, e os dois são graves por motivos opostos:

- **Deixar passar.** PII armazenada num produto de compliance é o fim da
  conversa com qualquer DPO.
- **Mascarar demais.** Identificador de tag é numérico e se parece com dado
  pessoal — o ID do Meta Pixel tem 13 a 16 dígitos, como um cartão. Estragá-lo
  quebra a detecção da própria tag que se quer auditar, e o laudo passa a dizer
  que o site está limpo.

Por isso nada casa só por formato: CPF, CNPJ e cartão passam por dígito
verificador antes de serem tocados.
"""
import json

import pytest

from audit_engine.mascarador import (
    MARCADOR,
    mascarar_har,
    mascarar_texto,
    resumo_das_ocorrencias,
)


class TestNaoQuebraOQueImporta:
    """O laudo precisa continuar reconhecendo as tags depois da limpeza."""

    def test_id_do_meta_pixel_sobrevive(self):
        """15 dígitos, formato de cartão — mas não passa no Luhn."""
        texto, achados = mascarar_texto("https://facebook.com/tr?id=1234567890123&ev=Purchase")
        assert "id=1234567890123" in texto, "o ID do pixel foi mascarado e a tag some do laudo"
        assert "cartao" not in achados

    def test_measurement_id_do_ga4_sobrevive(self):
        texto, _ = mascarar_texto("/g/collect?v=2&tid=G-ABC1234567&cid=1234567890.1234567890")
        assert "tid=G-ABC1234567" in texto

    def test_container_gtm_sobrevive(self):
        texto, _ = mascarar_texto("https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234")
        assert "GTM-ABC1234" in texto

    def test_client_id_do_ga_sobrevive(self):
        """`cid` é um identificador do GA, não telefone nem CPF."""
        texto, achados = mascarar_texto("cid=847362819.1691582734")
        assert "847362819.1691582734" in texto
        assert achados == []

    def test_numero_de_pedido_sobrevive(self):
        texto, _ = mascarar_texto("transaction_id=20260809123456")
        assert "20260809123456" in texto


class TestRemoveOQuePrecisa:
    def test_email(self):
        texto, achados = mascarar_texto("em=fulano.silva@empresa.com.br&ev=Purchase")
        assert "fulano.silva@empresa.com.br" not in texto
        assert MARCADOR["email"] in texto
        assert achados == ["email"]

    def test_cpf_com_pontuacao(self):
        """CPF válido de teste (dígitos verificadores conferem)."""
        texto, achados = mascarar_texto("cpf=529.982.247-25")
        assert "529.982.247-25" not in texto
        assert "cpf" in achados

    def test_cpf_sem_pontuacao(self):
        texto, achados = mascarar_texto("documento=52998224725")
        assert "52998224725" not in texto
        assert "cpf" in achados

    def test_cpf_invalido_nao_e_tocado(self):
        """Sequência de 11 dígitos que não passa no verificador é ID, não CPF."""
        texto, achados = mascarar_texto("pedido=12345678901")
        assert "12345678901" in texto
        assert achados == []

    def test_cnpj(self):
        texto, achados = mascarar_texto("cnpj=11.222.333/0001-81")
        assert "11.222.333/0001-81" not in texto
        assert "cnpj" in achados

    def test_cartao_valido_no_luhn(self):
        """Número de teste da Visa — passa no Luhn e precisa sumir."""
        texto, achados = mascarar_texto("card=4111111111111111")
        assert "4111111111111111" not in texto
        assert "cartao" in achados

    def test_telefone_brasileiro(self):
        texto, achados = mascarar_texto("phone=(11) 98765-4321")
        assert "98765-4321" not in texto
        assert "telefone" in achados

    def test_varios_no_mesmo_texto(self):
        texto, achados = mascarar_texto(
            "em=cliente@loja.com&cpf=529.982.247-25&card=4111111111111111"
        )
        assert "cliente@loja.com" not in texto
        assert "529.982.247-25" not in texto
        assert "4111111111111111" not in texto
        assert set(achados) == {"email", "cpf", "cartao"}


class TestMascaraOHarInteiro:
    def _har(self):
        return {
            "log": {
                "entries": [{
                    "pageref": "p3",
                    "request": {
                        "method": "POST",
                        "url": "https://loja.com.br/checkout?email=cliente@loja.com",
                        "headers": [{"name": "X-User", "value": "cliente@loja.com"}],
                        "postData": {
                            "text": "nome=Fulano&cpf=529.982.247-25",
                            "params": [{"name": "email", "value": "outro@loja.com"}],
                        },
                    },
                    "response": {
                        "cookies": [{"name": "user", "value": "cliente@loja.com"}],
                        "content": {
                            "mimeType": "application/json",
                            "text": '{"comprador": "fulano@loja.com", "tel": "(11) 98765-4321"}',
                        },
                    },
                }],
            }
        }

    def test_nenhum_email_sobrevive_em_lugar_nenhum(self):
        limpo, _ = mascarar_har(self._har())
        bruto = json.dumps(limpo)
        assert "@loja.com" not in bruto, "sobrou e-mail no HAR que vai para o banco"
        assert "529.982.247-25" not in bruto

    def test_registra_onde_cada_pii_estava(self):
        """É o achado do laudo: aponta o local, nunca o valor."""
        _, ocorrencias = mascarar_har(self._har())
        locais = {o["onde"] for o in ocorrencias}
        assert "URL (query string)" in locais
        assert "corpo da requisição" in locais
        assert "corpo da resposta" in locais
        assert any("cabeçalho" in x for x in locais)

    def test_ocorrencia_nao_carrega_o_valor(self):
        """Se o valor viajasse junto, todo o mascaramento seria inútil."""
        _, ocorrencias = mascarar_har(self._har())
        bruto = json.dumps(ocorrencias)
        assert "cliente@loja.com" not in bruto
        assert "fulano@loja.com" not in bruto

    def test_preserva_o_passo_do_percurso(self):
        """Sem o pageref, o laudo não sabe dizer em que tela vazou."""
        _, ocorrencias = mascarar_har(self._har())
        assert all(o["pageref"] == "p3" for o in ocorrencias)

    def test_resumo_conta_por_tipo(self):
        _, ocorrencias = mascarar_har(self._har())
        contagem = resumo_das_ocorrencias(ocorrencias)
        assert contagem.get("email", 0) >= 3


class TestEntradaImprestavel:
    def test_har_sem_log(self):
        limpo, ocorrencias = mascarar_har({"nada": 1})
        assert ocorrencias == []

    def test_entries_com_lixo(self):
        limpo, ocorrencias = mascarar_har({"log": {"entries": [None, "texto", 42]}})
        assert ocorrencias == []

    def test_texto_vazio(self):
        assert mascarar_texto("") == ("", [])

    def test_valor_nao_string(self):
        texto, achados = mascarar_texto(None)
        assert texto is None and achados == []

    def test_entrada_sem_postdata(self):
        har = {"log": {"entries": [{"request": {"url": "https://loja.com.br/"}}]}}
        limpo, ocorrencias = mascarar_har(har)
        assert ocorrencias == []

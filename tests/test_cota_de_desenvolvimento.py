"""Suspensão da cota semanal para desenvolvimento.

Testar o produto consome cota de verdade — cada varredura conta, e os modos
Deep e Tempo Real passam pelo mesmo caminho. Dez scans acabam numa tarde de
testes, e aí a mensagem de limite parece defeito do produto.

O risco do atalho é maior que o incômodo que ele resolve: o produto é vendido
por cota, então um bypass que vaze para produção é receita indo embora em
silêncio — ninguém abre chamado porque ganhou scan de graça. Por isso são duas
condições, e os testes abaixo existem principalmente para garantir que a
segunda não pode ser esquecida.
"""
import os

import pytest

from audit_engine.credit_rules import (
    WEEKLY_SCAN_LIMITS,
    can_perform_scan,
    cota_desligada,
    get_weekly_limit,
)


@pytest.fixture()
def ambiente(monkeypatch):
    """Controla as duas variáveis sem vazar para os outros testes."""
    def definir(dev_unlimited=None, environment=None):
        for chave, valor in (("DEV_UNLIMITED_SCANS", dev_unlimited),
                             ("ENVIRONMENT", environment)):
            if valor is None:
                monkeypatch.delenv(chave, raising=False)
            else:
                monkeypatch.setenv(chave, valor)
    return definir


class TestPrecisaDasDuasCondicoes:
    def test_ligada_em_desenvolvimento(self, ambiente):
        ambiente(dev_unlimited="1", environment="development")
        assert cota_desligada() is True
        assert get_weekly_limit("free") == -1
        assert can_perform_scan("free", weekly_scan_count=9999) is True

    def test_a_variavel_sozinha_nao_basta(self, ambiente):
        """O caso que este arquivo existe para impedir: alguém sobe em
        produção com a variável setada por engano e todo mundo ganha varredura
        ilimitada, sem ninguém reclamar."""
        ambiente(dev_unlimited="1", environment="production")
        assert cota_desligada() is False
        assert get_weekly_limit("free") == WEEKLY_SCAN_LIMITS["free"]
        assert can_perform_scan("free", weekly_scan_count=10) is False

    def test_desenvolvimento_sozinho_nao_basta(self, ambiente):
        """Sem pedir explicitamente, a cota continua valendo — o padrão do
        ambiente local não pode ser 'sem limite'."""
        ambiente(dev_unlimited=None, environment="development")
        assert cota_desligada() is False
        assert can_perform_scan("free", weekly_scan_count=10) is False

    def test_staging_nao_e_desenvolvimento(self, ambiente):
        ambiente(dev_unlimited="1", environment="staging")
        assert cota_desligada() is False


class TestFormatosAceitos:
    @pytest.mark.parametrize("valor", ["1", "true", "TRUE", "yes", " 1 "])
    def test_valores_que_ligam(self, ambiente, valor):
        ambiente(dev_unlimited=valor, environment="development")
        assert cota_desligada() is True

    @pytest.mark.parametrize("valor", ["0", "false", "no", "", "sim", "talvez"])
    def test_valores_que_nao_ligam(self, ambiente, valor):
        """Qualquer coisa que não seja um 'sim' explícito mantém a cota.

        Errar para o lado de cobrar é recuperável — o cliente reclama e a gente
        devolve. Errar para o lado de liberar não volta."""
        ambiente(dev_unlimited=valor, environment="development")
        assert cota_desligada() is False


class TestNaoQuebraOResto:
    def test_admin_continua_ilimitado(self, ambiente):
        ambiente(dev_unlimited=None, environment="production")
        assert get_weekly_limit("free", is_admin=True) == -1

    def test_limites_dos_planos_intactos(self, ambiente):
        ambiente(dev_unlimited=None, environment="production")
        assert get_weekly_limit("free") == 10
        assert get_weekly_limit("premium") == 200

    def test_a_leitura_e_por_chamada(self, ambiente):
        """Ler no import congelaria o valor e exigiria reiniciar o servidor
        para ligar ou desligar — justamente no ambiente onde se está mexendo."""
        ambiente(dev_unlimited="1", environment="development")
        assert cota_desligada() is True
        ambiente(dev_unlimited="0", environment="development")
        assert cota_desligada() is False

"""Módulo de persistência no Supabase."""

import contextlib
import os
from typing import Any

try:
    from supabase import Client, create_client
except Exception as _supabase_err:
    print(f"[AVISO SUPABASE]: Falha ao importar SDK do Supabase ({_supabase_err})")
    Client = None
    create_client = None  # type: ignore[assignment]


class SupabaseService:
    """Serviço encapsulado para integração com o banco de dados Supabase."""

    def __init__(self) -> None:
        """Inicializa a conexão com o Supabase usando variáveis de ambiente."""
        self.url: str = os.getenv("SUPABASE_URL", "")
        self.key: str = os.getenv("SUPABASE_KEY", "")
        self.client: Client | None = None

        if self.url and self.key and Client:
            with contextlib.suppress(Exception):
                self.client = create_client(self.url, self.key)

    def salvar_ata(
        self,
        titulo: str,
        conteudo_markdown: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Insere um novo registro de ata na tabela 'atas' do Supabase."""
        if not self.client:
            return None

        dados = {
            "titulo": titulo,
            "conteudo": conteudo_markdown,
            "metadata": metadata or {},
        }

        try:
            resposta = self.client.table("atas").insert(dados).execute()
        except Exception as err:  # noqa: BLE001
            print(f"[SupabaseService] Erro ao salvar ata no banco de dados: {err}")  # noqa: T201
            return None
        else:
            return resposta.data

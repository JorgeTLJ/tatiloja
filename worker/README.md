# Servidor de pagamento da Tati Loja

Cloudflare Worker que faz duas coisas:

1. `POST /checkout`: recebe a sacola do site, **recalcula preços e frete a partir de `data/loja.json`** (nunca confia no navegador) e cria o pagamento no Mercado Pago (Checkout Pro). Devolve o link de pagamento.
2. `POST /webhook`: aviso do Mercado Pago. Consulta o pagamento na API do Mercado Pago (fonte da verdade) e grava/atualiza a venda em `vendas.json` do repositório privado `tldados`. O painel mostra a venda sozinho.

## Segredos (criar no painel da Cloudflare, nunca no código)

| Nome | O que é |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de produção do Mercado Pago |
| `MP_WEBHOOK_SECRET` | Chave secreta gerada ao configurar o webhook no Mercado Pago |
| `GH_TOKEN` | Token do GitHub (fine-grained) só com acesso ao repositório `tldados`, permissão Contents: Read and write |

Variáveis comuns (em `wrangler.toml`): `SITE_URL`, `ALLOWED_ORIGINS`, `DATA_REPO`, `MAX_INSTALLMENTS`, `STRICT_SIGNATURE`.

## Publicação

Cloudflare → Workers & Pages → Create → Import a repository → `tatiloja`, pasta raiz `worker`. A cada commit em `worker/`, a Cloudflare publica de novo.

## Testes

```
cd worker && node test/test.mjs
```

Simula Mercado Pago e GitHub. Cobre preço vindo do catálogo, frete por região, validações, webhook (pendente → pago, conflito de gravação, aviso repetido, fora de ordem, estorno) e assinatura.

## Observações

- A assinatura do webhook (`x-signature`) é conferida, mas só recusa avisos inválidos com `STRICT_SIGNATURE=1`. Mesmo sem isso, um aviso falso não cria venda: o servidor sempre confirma o pagamento direto na API do Mercado Pago.
- Boleto e caixa eletrônico ficam desligados (só Pix e cartão).

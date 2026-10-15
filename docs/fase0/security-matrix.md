# Forge Portal — Matriz de segurança (FASE 0)

| Superfície         | Ameaça                         | Controle                                                                  | Verificação                                |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------ |
| Bind               | Exposição na LAN               | somente `127.0.0.1`, sem flag de rede                                     | teste: connect externo recusado            |
| Sessão             | outro processo local usa a API | token 128-bit na URL → cookie SameSite=Strict + `X-Forge-Session`         | request sem header → 403                   |
| CSRF               | site malicioso dispara POST    | Origin allowlist loopback + Content-Type JSON obrigatório + double-submit | POST cross-origin → 403                    |
| Comando arbitrário | RCE via UI                     | operation registry tipado; argv fixo dos serviços; nenhum shell           | enumeração de ops ≠ allowlist → 404        |
| Install/uninstall  | mutação sem consentimento      | plan_token + `confirm` literal + receipt verificado                       | apply sem token → 400                      |
| Path traversal     | leitura de arquivos            | assets só do manifest sha256; prefixo fixo; `..` normalizado→404          | `GET /../` → 404                           |
| Segredos           | vazamento de token/cookie host | allowlist de campos; hostflow já retorna só `logged_in`                   | varredura de resposta sem `token`/`cookie` |
| Logs               | segredo em log                 | redação por allowlist; correlation_id sem payload                         | grep de resposta/log                       |
| Payload            | DoS por corpo grande           | limite 1 MiB por request                                                  | 413 no overflow                            |
| Rate               | flood de mutações              | janela por sessão (10/min mutáveis)                                       | 429 no 11º POST/min                        |
| iframe Studio      | clickjacking/XSS               | `sandbox="allow-scripts"`, `csp` no documento servido                     | header CSP presente                        |
| Headers            | sniffing/clickjacking          | `X-Content-Type-Options`, `Referrer-Policy`, CSP básico                   | checagem de header                         |
| Timeouts           | request preso                  | timeouts por operação (verify 30s, exec 300s)                             | op lenta → 504                             |

## Decisões

- **Sem auth de usuário**: ferramenta local single-user; a sessão
  aleatória + loopback é o limite (igual Jupyter/Graph Studio).
- **Launch de host pelo portal**: não há TTY real atrás do browser →
  o portal oferece o comando copiável e a orientação; launch direto só
  se existir caminho documentado seguro — caso contrário UNVERIFIED
  honesto, nunca fingido.
- **MCP verify**: só operações read-only de handshake/invoke seguro.
- **Sem auto-install de ferramentas externas**: o assistente mostra
  plano + fonte oficial; execução fica como exceção explícita, nunca
  `curl|bash` silencioso.

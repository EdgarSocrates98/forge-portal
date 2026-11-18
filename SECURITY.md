# Política de Segurança

## Reportar vulnerabilidades

**Não abra issue pública para vulnerabilidades.** Reporte via
GitHub Security Advisories do repositório (aba Security → Report a
vulnerability) ou pelo perfil do mantenedor.

## Escopo

- Código deste repositório e artefatos que ele distribui.
- Recepção de dados não-confiáveis, execução de subprocessos, redação de
  segredos e proveniência são partes do modelo de ameaça.

## Garantias do projeto

- Persistência passa por redação na fronteira — segredos nunca em claro.
- Nenhum caminho reporta sucesso sem evidência válida.
- Achados de auditoria ficam registrados com CVE/GHSA e evidência.

Sem promessa de SLA formal — projeto open-source mantido pelo autor.

## Modelo de segurança do portal (resumo)

O servidor canônico (`portal_core/forge_portal.py`, vendored como
`_forge_portal.py` nas Forjas irmãs) aplica, em todo request:

- bind apenas em loopback; token de sessão por servidor
  (`X-Forge-Session`); Origin + Content-Type como guarda CSRF;
- Host-header guard (anti DNS-rebinding), teto de body, rate limit em
  endpoints mutantes;
- `plan_token` HMAC descartável (anti-replay) para mutações
  plan→confirm→execute; recusas nomeadas `PORTAL-*`/`FORGE-*`;
- redação de segredos em toda resposta e guardas contra traversal e
  symlink; zero shell no servidor canônico;
- CSP e headers restritivos (`X-Frame-Options`, `Permissions-Policy`).

Detalhes: `docs/fase0/security-matrix.md`, `docs/security/`.

## Variáveis de ambiente sensíveis

- **`FORGE_CLI_BIN`** — override do binário `forge-cli` usado por
  `portal_core/registry_ops.py`. É configuração de operador: um valor
  apontando para binário malicioso executa com as credenciais do
  usuário. Exporte-o apenas em ambientes controlados e trate-o como
  parte da fronteira de confiança — o portal nunca o expõe a input de
  rede, mas também não pode validar a intenção do operador.
- `FORGE_PORTAL_HOME`, `FORGE_ATLAS_URL` e `*_HOME`/`*_VENV`/`*_PYTHON`
  das Forjas — paths/URLs publicados por instaladores; o portal reporta
  presença e validade sem ecoar valores arbitrários.

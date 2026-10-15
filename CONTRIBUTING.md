# Contribuindo

## Antes de contribuir

1. Abra uma issue descrevendo a mudança — mudanças de contrato/surface
   precisam de discussão prévia (feature freeze / RC discipline quando
   aplicável).
2. Leia `AGENTS.md`/`CLAUDE.md` — invariantes do repo são contrato, não estilo.

## DCO — Developer Certificate of Origin

Toda contribuição exige `Signed-off-by` (decisão D3 de
`cycle-10-decisions.md`):

```bash
git commit -s -m "sua mensagem"
```

Ao assinar, você certifica o direito de submeter a contribuição sob a
licença do projeto (MIT) — texto em https://developercertificate.org/.

## Gates

Rode os gates do repo antes do push (ver `AGENTS.md`): testes, lint,
tipos e os checks específicos de cada Forja. PR verde ou com falha
explicada é a norma — nunca "funcionou na minha máquina".

## Commits e PRs

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:` …).
- PR descreve o *porquê*, evidencia a verificação e lista o que ficou
  `unresolved`.

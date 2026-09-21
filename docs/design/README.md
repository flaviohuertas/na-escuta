# Identidade visual — "Sinal"

Direção escolhida entre três propostas (Sinal, Bastidor, Régua). A referência visual é
[`identidade-a.png`](identidade-a.png): marca, paleta, tipografia, componentes e duas telas de exemplo.

**Ideia:** "na escuta" é o que se diz no rádio da produção. A marca é um ponto que emite sinal (três arcos
que enfraquecem); as cores são papel quente, tinta e um laranja de sinalização.

## Onde as decisões moram no código

| O quê | Onde |
|---|---|
| Cores, fontes, foco visível, títulos | [`src/app/globals.css`](../../src/app/globals.css) (`@theme`) |
| Fontes (auto-hospedadas, funcionam offline) | [`src/app/layout.tsx`](../../src/app/layout.tsx) (`next/font`) |
| Marca (`LogoMark`, `Wordmark`) | [`src/components/ui/Logo.tsx`](../../src/components/ui/Logo.tsx) |
| Botão (`Button`, `buttonClass`) | [`src/components/ui/Button.tsx`](../../src/components/ui/Button.tsx) |
| Selo de situação (`Badge`) | [`src/components/ui/Badge.tsx`](../../src/components/ui/Badge.tsx) |
| Ícones | [`src/components/ui/Icon.tsx`](../../src/components/ui/Icon.tsx) |
| Menu (o que cada papel vê) | [`src/components/layout/nav-model.ts`](../../src/components/layout/nav-model.ts) |
| Menu (a apresentação) | [`src/components/layout/AppNav.tsx`](../../src/components/layout/AppNav.tsx) |
| Ícone do app instalado / manifesto | `public/icon.svg`, `public/manifest.webmanifest` |

## Paleta

| Token | Valor | Uso |
|---|---|---|
| `ink` | `#16181d` | texto, barra lateral |
| `ink-soft` | `#2b2e36` | quadrado da marca sobre a tinta |
| `ink-muted` | `#a7a196` | texto secundário **sobre** a tinta (6,9:1) |
| `paper` | `#f6f2ea` | fundo das telas |
| `line` | `#e2dacb` | bordas |
| `brand-600` | `#c8380a` | botão primário, links (texto branco sobre ele: 5,2:1) |
| `brand-500` | `#ff5a1f` | "brilho": gráficos e detalhes sobre fundo escuro, nunca texto pequeno sobre claro |
| `slate-*` | escala quente | **remapeada**: todo `text-slate-*`/`border-slate-*` já usa esta paleta |

A escala `slate` do Tailwind foi trocada por neutros quentes (`slate-400` em diante passa de 4,5:1 sobre
branco e sobre o papel). Os selos de situação seguem os pares que o sistema já usava
(`emerald`/`amber`/`red`/`sky`), reunidos em `Badge`.

## Tipografia

- **Títulos (`h1`, `h2`) e números grandes:** Bricolage Grotesque, peso 800, `letter-spacing: -0.03em`.
  A regra é global e **sem camada** de propósito (vence o `font-semibold` que as telas antigas põem nos
  títulos). `font-display` dá a mesma fonte a qualquer outro elemento.
- **Texto, tabelas, formulários:** Instrument Sans.

## Regras de uso

1. **Alvo de toque de 44 px** em tudo que é tocado no celular (`Button size="md"`, abas do menu).
2. **A cor nunca é a única pista:** todo selo (`Badge`) leva texto (Estourou, Dentro do previsto…).
3. **Não travar o zoom** (`viewport` sem `maximum-scale`).
4. **Só `className` de layout** em `Button`/`buttonClass` (`w-full`, `ml-auto`); cor e tamanho vêm da variante.
5. **Sem emoji e sem ícone baixado:** ícones são SVG embutidos (`Icon`), para existirem também offline.
6. O que a pessoa **não pode** usar não aparece no menu (a guarda de verdade continua no servidor).

## Como isso é verificado

| O quê | Como | Onde |
|---|---|---|
| Contraste dos pares de cor da paleta | Razão WCAG calculada **por código** a partir dos tokens do `globals.css` (texto 4,5:1, gráficos 3:1). Mexeu numa cor e um par deixou de ler bem: falha. | `tests/unit/design/tokens.test.ts` |
| Contraste e estrutura no navegador | **axe-core** (WCAG 2.0/2.1 A e AA) em 20 telas, no desktop e no celular, mais login, equipe de campo e o painel "Mais" aberto. Zero violações. | `tests/e2e/accessibility.spec.ts` |
| Aparência | Capturas de referência do login, do formulário de evento, das barras e do painel "Mais". Tolerância de 20 pixels. | `tests/e2e/visual.spec.ts` |
| Menu no Safari | O E2E do menu do celular rodando no **WebKit**, com o iPhone 13 emulado (toque, tela pequena, `<dialog>`). | `npx playwright install webkit` e `E2E_WEBKIT=1 npx playwright test --project=webkit-iphone` |

Notas:
- As imagens de referência levam o sistema no nome (`-chromium-win32.png`), porque fonte e suavização mudam de
  um sistema para outro. Em outro sistema, gere as suas com `npx playwright test visual --update-snapshots` e
  **não** copie as de um para o outro. Mudança de aparência de propósito: rode com `--update-snapshots`, olhe as
  imagens e faça commit.
- O axe só trata um link como "dentro de um bloco de texto" quando o texto ao redor é maior que o link; por isso o
  teste dá nomes **curtos** aos dados que cria (com um nome longo o defeito passava sem ser visto).
- Nada disso substitui um aparelho de verdade: o WebKit do Playwright é o motor do Safari, mas não é um iPhone
  (sem áreas seguras, sem teclado do sistema, sem o navegador embutido do app instalado).

## O que ainda não foi migrado

Só o esqueleto foi refeito (tokens, fontes, menu, login, barra de sincronização). As telas antigas ganharam a
paleta e as fontes de graça, mas ainda montam botões, cartões e campos à mão. Próximas fatias:
**telas do campo** (evento, tarefas, checklists, ocorrências), **gestão no desktop** (larguras de conteúdo
consistentes, tabelas), **proposta impressa** (logo e cabeçalho) e os componentes que faltam (`Card`, `Field`,
`PageHeader`), que entram junto com as telas que os usam — não antes. **Modo escuro** (direção "Bastidor")
ficou de fora; os tokens estão em variáveis, então cabe depois sem refazer telas.

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
| Botão (`Button`, `buttonClass`; variantes `primary`, `secondary`, `ghost`, `danger`, `ghost-danger`) | [`src/components/ui/Button.tsx`](../../src/components/ui/Button.tsx) |
| Selo de situação (`Badge`) | [`src/components/ui/Badge.tsx`](../../src/components/ui/Badge.tsx) |
| Campo de formulário (`Field`, `inputClass`, `compactSelectClass`, `RequiredNote`) | [`src/components/ui/Field.tsx`](../../src/components/ui/Field.tsx) |
| Foco no primeiro campo com erro depois de um envio recusado | [`src/components/ui/use-focus-first-invalid.ts`](../../src/components/ui/use-focus-first-invalid.ts) |
| Topo de tela (`PageHeader`, `BackLink`) | [`src/components/ui/PageHeader.tsx`](../../src/components/ui/PageHeader.tsx) |
| Cartão (`Card`, `cardClass`), lista vazia e carregando (`EmptyState`, `LoadingLine`), barra de andamento (`ProgressBar`) | [`Card.tsx`](../../src/components/ui/Card.tsx), [`EmptyState.tsx`](../../src/components/ui/EmptyState.tsx), [`ProgressBar.tsx`](../../src/components/ui/ProgressBar.tsx) |
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
7. **Campo:** borda `slate-400` (3:1 sobre o papel e o branco — WCAG 1.4.11; `slate-300` dava 1,5:1), texto de 16 px (abaixo disso o
   Safari do iPhone dá zoom na tela ao focar) e o contorno de foco global (`globals.css`), o mesmo de botões e links. Use
   `inputClass`/`compactSelectClass`; um teste barra campo escrito à mão com a borda clara.
8. **Formulário:** todo campo vai dentro de `Field`, que liga o erro e a dica ao campo (`aria-describedby`), marca `aria-invalid` e
   `aria-required`. Campo obrigatório leva `required` no `Field` (asterisco fora do `<label>`, explicado por `RequiredNote`);
   opcional segue "(opcional)" no rótulo. Depois de um envio recusado, `useFocusFirstInvalid` leva o foco ao primeiro erro.
9. **Ação que apaga pede confirmação** no próprio lugar (foco na opção segura, "Cancelar" devolve o foco ao botão). O botão diz
   o que faz ("Iniciar", "Concluir", "Reabrir"), com o nome da tarefa no nome acessível.
10. **Lista que lê do aparelho** distingue "carregando" (`LoadingLine`) de "vazia" (`EmptyState`, fora do `<ul>`): consultar o
    IndexedDB começa em `undefined`, não em `[]`.

## Como isso é verificado

| O quê | Como | Onde |
|---|---|---|
| Contraste dos pares de cor da paleta e das **bordas dos campos** | Razão WCAG calculada **por código** a partir dos tokens do `globals.css` e das classes de `Field.tsx` (texto 4,5:1, gráficos, bordas e foco 3:1). Mexeu numa cor, ou escreveu um campo à mão com a borda clara: falha. | `tests/unit/design/tokens.test.ts` |
| Campo, erro, foco e telas de campo | `Field` (descrição, `aria-invalid`, `aria-required`), `useFocusFirstInvalid`, a tela de tarefas (confirmar antes de excluir, carregando × vazio) e o checklist (alvo, "Obrigatório"). | `tests/unit/components/field.test.tsx`, `tasks-screen.test.tsx`, `checklist-detail.test.tsx` |
| Contraste, estrutura e **tamanho de alvo** no navegador | **axe-core** (WCAG 2.0, 2.1 e **2.2** A e AA — a 2.2 traz `target-size`, 24 px) em 20 telas, no desktop e no celular, mais login, equipe de campo, o painel "Mais" aberto e as **telas de campo com dados** (evento, tarefas, checklists e ocorrências, listas e detalhes). Zero violações. | `tests/e2e/accessibility.spec.ts` |
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

Feitos: o esqueleto (tokens, fontes, menu, login, barra de sincronização), as **telas de campo** (evento, tarefas,
checklists, ocorrências) e os **campos de todos os formulários** (borda, tamanho, foco, erro ligado ao campo).

Ainda à mão, de propósito deixados para as próximas fatias:
- **Gestão no desktop:** as telas de Comercial, Fornecedores, Financeiro e Aprovações ainda montam botões, selos e o link de
  voltar (`text-sm text-slate-600`, uns 20 px de altura) sem `Button`, `Badge` e `PageHeader`; os selos de saúde do painel,
  de comparação do financeiro e de prazo têm cores próprias, em vez do `Badge`. Larguras de conteúdo e tabelas seguem por ali.
- **Formulários de orçamento e proposta:** as linhas de item usam `aria-label` e não marcam `aria-invalid` por linha, então o
  foco no primeiro erro só vale para os campos soltos deles.
- **Um resumo de erros** no topo dos formulários compridos (hoje o foco vai ao primeiro campo com erro, sem lista).
- **Lista de eventos no celular** (cartão e até três ações lado a lado), a **barra de sincronização** (a barra inteira é uma
  região `aria-live`) e a **aba "Sincronização"** em telas de 320–360 px: apontados na avaliação, ainda não medidos no aparelho.
- **Proposta impressa** (logo e cabeçalho) e o **login**, que mostra o usuário e a senha de demonstração a qualquer visitante.
- **Modo escuro** (direção "Bastidor") ficou de fora; os tokens estão em variáveis, então cabe depois sem refazer telas.

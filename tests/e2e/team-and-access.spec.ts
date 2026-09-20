import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: papel restrito (equipe)
const PASSWORD = "NaEscuta#2026";

/** Entra SEM esperar o catálogo: quem tem senha provisória é levado à troca de senha. */
async function loginRaw(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

async function newDevice(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Todas as linhas de uma tabela do IndexedDB do app (é ali que está a verdade sobre o que o aparelho guarda). */
async function idbAll(page: Page, store: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    (storeName) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const open = indexedDB.open("na-escuta");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(storeName).objectStore(storeName).getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(req.result as Array<Record<string, unknown>>);
          };
        };
      }),
    store
  );
}

/** Quais caches do navegador existem (o do Service Worker guarda o HTML das telas dos eventos). */
async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

test.describe("Equipe, senha provisória e acesso ao evento", () => {
  test("cadastro → senha provisória → troca obrigatória → acesso ao evento → revogação chega ao aparelho → vínculo encerrado", async ({
    browser,
  }) => {
    const stamp = Date.now();
    const colleagueName = `Colega E2E ${stamp}`;
    const typedEmail = `Colega.E2E.${stamp}@Naescuta.com.br`; // maiúsculas de propósito
    const loginEmail = typedEmail.toLowerCase();
    const eventName = `Evento do colega ${stamp}`;

    // ---- Administradora: cadastra a pessoa e cria um evento ----
    const admin = await newDevice(browser);
    await login(admin.page);
    await admin.page.getByRole("navigation").getByRole("link", { name: "Equipe", exact: true }).click();
    await admin.page.waitForURL(/\/administracao\/equipe$/);

    await admin.page.getByLabel("Nome", { exact: true }).fill(colleagueName);
    await admin.page.getByLabel("E-mail").fill(typedEmail);
    await admin.page.getByLabel("Papel na empresa").selectOption("STAFF");
    await admin.page.getByRole("button", { name: "Adicionar" }).click();

    const panel = admin.page.getByTestId("temp-password-panel");
    await expect(panel).toContainText("esta senha não aparece de novo");
    const tempPassword = (await admin.page.getByTestId("temp-password").innerText()).trim();
    expect(tempPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    // O nome aparece no painel da senha E na lista; e o selo "pendente" se acumula de outras rodadas: escopo por linha.
    const teamRow = admin.page.getByRole("main").locator("li").filter({ hasText: colleagueName });
    await expect(teamRow).toBeVisible();
    await expect(teamRow.getByText("Senha provisória pendente")).toBeVisible();

    await admin.page.goto("/eventos/novo");
    await admin.page.getByLabel("Nome do evento").fill(eventName);
    await admin.page.getByLabel("Início").fill("2026-12-01T18:00");
    await admin.page.getByLabel("Término").fill("2026-12-01T23:00");
    await admin.page.getByRole("button", { name: "Criar evento" }).click();
    await admin.page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
    const eventUrl = admin.page.url();

    // ---- Administradora: dá acesso ao evento ----
    await admin.page.goto(`${eventUrl}/acessos`);
    await expect(admin.page.getByRole("heading", { name: "Pessoas do evento" })).toBeVisible();
    // O rótulo da opção traz nome, e-mail e papel; acha a opção pelo nome e escolhe pelo valor.
    const personSelect = admin.page.getByLabel("Pessoa", { exact: true });
    const optionValue = await personSelect.locator("option", { hasText: colleagueName }).getAttribute("value");
    await personSelect.selectOption(optionValue!);
    await admin.page.getByRole("button", { name: "Dar acesso" }).click();
    await expect(admin.page.getByRole("main").getByRole("status")).toContainText("Acesso concedido.");
    await expect(admin.page.getByRole("main").locator("li").filter({ hasText: colleagueName })).toBeVisible();

    // ---- A pessoa: entra com a senha provisória e é OBRIGADA a trocá-la ----
    const colleague = await newDevice(browser);
    await loginRaw(colleague.page, loginEmail, tempPassword);
    await colleague.page.waitForURL(/\/trocar-senha$/);
    await expect(colleague.page.getByText(/entrou com uma senha provisória/)).toBeVisible();

    // O app não abre enquanto a senha for a provisória.
    await colleague.page.goto("/eventos");
    await colleague.page.waitForURL(/\/trocar-senha$/);
    await colleague.page.goto(`${eventUrl}/tarefas`);
    await colleague.page.waitForURL(/\/trocar-senha$/);

    // Um SEGUNDO aparelho entra com a mesma senha provisória (é a que a administração entregou).
    const otherDevice = await newDevice(browser);
    await loginRaw(otherDevice.page, loginEmail, tempPassword);
    await otherDevice.page.waitForURL(/\/trocar-senha$/);

    // Senha provisória errada: recusa e continua na troca.
    const newPassword = `Nova-senha-${stamp}`;
    await colleague.page.getByLabel("Senha provisória").fill("Errada-Errada");
    await colleague.page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await colleague.page.getByLabel("Repita a nova senha").fill(newPassword);
    await colleague.page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(colleague.page.getByText("A senha atual não confere.")).toBeVisible();

    await colleague.page.getByLabel("Senha provisória").fill(tempPassword);
    await colleague.page.getByRole("button", { name: "Salvar nova senha" }).click();
    await colleague.page.waitForURL(/\/eventos$/);

    // Vê só o que lhe foi dado, sem poderes de gestão.
    const main = colleague.page.getByRole("main");
    await expect(main.getByText(eventName)).toBeVisible();

    // Trocar a senha derruba as OUTRAS sessões (o segundo aparelho sai), mas não a de quem trocou
    // (a rota reemite o cookie): o aparelho que trocou continua logado, como a linha acima mostra.
    await otherDevice.page.goto("/trocar-senha");
    await otherDevice.page.waitForURL(/\/login/);
    await otherDevice.context.close();

    await expect(main.getByText("Equipe de campo")).toBeVisible();
    await expect(main.getByRole("link", { name: "Novo evento" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: /^Editar/ })).toHaveCount(0);
    await expect(colleague.page.getByRole("navigation").getByRole("link", { name: "Equipe", exact: true })).toHaveCount(0);
    await colleague.page.goto("/administracao/equipe");
    await expect(colleague.page.getByText("Só a titularidade e a administração da empresa cuidam da equipe.")).toBeVisible();

    // A senha provisória não vale mais; a nova vale (e o e-mail em maiúsculas/minúsculas não importa).
    const relogin = await newDevice(browser);
    await loginRaw(relogin.page, loginEmail, tempPassword);
    await expect(relogin.page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await loginRaw(relogin.page, typedEmail, newPassword);
    await relogin.page.waitForURL(/\/eventos$/);
    await relogin.context.close();

    // ---- A pessoa prepara o evento no aparelho dela ----
    await colleague.page.goto("/eventos");
    await main.locator('a[href^="/eventos/"]').filter({ hasText: eventName }).first().click();
    await colleague.page.waitForURL(/\/eventos\/[^/]+$/);
    await colleague.page.getByRole("button", { name: "Preparar evento para uso offline" }).click();
    await expect(colleague.page.getByText("Disponível offline", { exact: true })).toBeVisible({ timeout: 30_000 });
    const eventId = new URL(eventUrl).pathname.split("/").pop()!;

    // ---- A pessoa deixa, no aparelho, uma alteração que o servidor ainda NÃO recebeu ----
    // (criar não dispara sincronização, e voltar é navegação interna: nada a envia antes da revogação)
    const pendingTask = `Tarefa de campo ${stamp}`;
    await colleague.page.getByRole("link", { name: "Tarefas" }).click();
    await colleague.page.getByLabel("Nova tarefa").fill(pendingTask);
    await colleague.page.getByRole("button", { name: "Adicionar" }).click();
    await expect(colleague.page.getByText(pendingTask)).toBeVisible();
    await colleague.page.goBack();
    await expect(colleague.page.getByRole("heading", { name: eventName })).toBeVisible();

    // ---- Administradora: retira o acesso ao evento ----
    await admin.page.reload();
    await admin.page.getByRole("button", { name: `Retirar o acesso de ${colleagueName}` }).click();
    await expect(admin.page.getByRole("main").getByRole("status")).toContainText("Acesso retirado.");
    await expect(admin.page.getByRole("main").locator("li").filter({ hasText: colleagueName }).getByText("Acesso retirado", { exact: true })).toBeVisible();

    // ---- A revogação CHEGA ao aparelho: aviso em palavras e o evento SAI do aparelho ----
    await colleague.page.getByRole("button", { name: "Sincronizar agora" }).first().click();
    const notice = colleague.page.getByRole("alert").filter({ hasText: "Seu acesso a este evento foi retirado." });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).not.toContainText("EVENT_ACCESS_REVOKED");
    await expect(notice).toContainText("foram removidos deste aparelho");
    // Ficou só o que o servidor NUNCA recebeu (o push foi recusado: a pessoa já não tem acesso).
    await expect(notice).toContainText("1 alteração não enviada");
    await expect(colleague.page.getByRole("heading", { name: eventName })).toHaveCount(0);
    await expect(colleague.page.getByRole("link", { name: "Tarefas" })).toHaveCount(0);

    // A verdade está no IndexedDB e no cache do navegador, não só na tela.
    const onDevice = await colleague.page.evaluate(
      (id) =>
        new Promise<{ events: number; tasks: number; outbox: number; state: boolean; cachedHtml: boolean }>((resolve, reject) => {
          const open = indexedDB.open("na-escuta");
          open.onerror = () => reject(open.error);
          open.onsuccess = async () => {
            const db = open.result;
            const count = (store: string, index?: string) =>
              new Promise<number>((res, rej) => {
                const os = db.transaction(store).objectStore(store);
                const req = index ? os.index(index).count(IDBKeyRange.only(id)) : os.count(IDBKeyRange.only(id));
                req.onsuccess = () => res(req.result);
                req.onerror = () => rej(req.error);
              });
            const cache = await caches.open("na-escuta-pages-v1");
            resolve({
              events: await count("events"),
              tasks: await count("tasks", "eventId"),
              outbox: await count("outbox", "eventId"),
              state: (await count("syncState")) > 0,
              cachedHtml: Boolean(await cache.match(`/eventos/${id}`, { ignoreVary: true })),
            });
          };
        }),
      eventId
    );
    expect(onDevice).toEqual({ events: 0, tasks: 0, outbox: 1, state: true, cachedHtml: false });

    // ---- Exportar a alteração: arquivo cifrado, sem a tarefa em claro ----
    await notice.getByRole("button", { name: "Exportar alterações não enviadas" }).click();
    await colleague.page.getByLabel("Senha para proteger o arquivo exportado").fill("senha-do-arquivo-123");
    const downloadPromise = colleague.page.waitForEvent("download");
    await colleague.page.getByRole("button", { name: "Exportar arquivo cifrado" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^na-escuta-pendencias-\d{4}-\d{2}-\d{2}\.json$/);
    const exportedText = await readFile((await download.path())!, "utf8");
    expect(exportedText).toContain("ciphertext");
    expect(exportedText).not.toContain(pendingTask);
    await expect(notice).toContainText("Exportado:");
    await expect(notice).toContainText("1 alteração não enviada"); // exportar não apaga

    // ---- Remover do aparelho: pede confirmação, diz o que se perde, e só então apaga ----
    await notice.getByRole("button", { name: "Remover do aparelho" }).click();
    await expect(notice).toContainText("agora e para sempre");
    await notice.getByRole("button", { name: "Sim, remover do aparelho" }).click();
    await colleague.page.waitForURL(/\/eventos$/);
    const leftover = await colleague.page.evaluate(
      (id) =>
        new Promise<{ outbox: number; state: number }>((resolve, reject) => {
          const open = indexedDB.open("na-escuta");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const outbox = db.transaction("outbox").objectStore("outbox").index("eventId").count(IDBKeyRange.only(id));
            outbox.onerror = () => reject(outbox.error);
            outbox.onsuccess = () => {
              const state = db.transaction("syncState").objectStore("syncState").count(IDBKeyRange.only(id));
              state.onerror = () => reject(state.error);
              state.onsuccess = () => resolve({ outbox: outbox.result, state: state.result });
            };
          };
        }),
      eventId
    );
    expect(leftover).toEqual({ outbox: 0, state: 0 });

    // Sem o acesso, o evento sai do catálogo da pessoa.
    await colleague.page.goto("/eventos");
    await expect(colleague.page.getByRole("main").getByText(eventName)).toHaveCount(0);

    // ---- Administradora: encerra o vínculo ----
    await admin.page.goto("/administracao/equipe");
    await admin.page.getByRole("button", { name: `Encerrar o vínculo de ${colleagueName}` }).click();
    await expect(admin.page.getByText(/perde o acesso a todos os eventos/)).toBeVisible();
    await admin.page.getByRole("button", { name: "Confirmar" }).click();
    await expect(admin.page.getByRole("main").getByRole("status")).toContainText("Vínculo encerrado");
    // Por linha: colegas de outras rodadas também mostram este selo.
    await expect(admin.page.getByRole("main").locator("li").filter({ hasText: colleagueName }).getByText("Vínculo encerrado", { exact: true })).toBeVisible();

    // A sessão que a pessoa tinha aberta CAI: sem vínculo, o app nem abre (antes, ela ficava numa
    // tela vazia, dentro do app, até o token expirar).
    await colleague.page.reload();
    await colleague.page.waitForURL(/\/login/);

    // E entrar de novo é recusado, com a senha certa: sem empresa não há o que abrir. A tela não
    // entra em laço de redirecionamento (login → app → login), que era o risco de deixar entrar.
    await loginRaw(colleague.page, loginEmail, newPassword);
    await expect(colleague.page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await expect(colleague.page).toHaveURL(/\/login/);

    await admin.context.close();
    await colleague.context.close();
  });

  test("vínculo encerrado: sem sessão nem login, o aparelho descobre sozinho e se limpa — guardando só o que não foi enviado", async ({
    browser,
  }) => {
    const stamp = Date.now();
    const name = `Ex-colega ${stamp}`;
    const email = `ex.colega.${stamp}@naescuta.com.br`;
    const eventName = `Evento do ex-colega ${stamp}`;

    // ---- Administradora: cadastra a pessoa, cria um evento e dá acesso a ela ----
    const admin = await newDevice(browser);
    await login(admin.page);
    await admin.page.goto("/administracao/equipe");
    await admin.page.getByLabel("Nome", { exact: true }).fill(name);
    await admin.page.getByLabel("E-mail").fill(email);
    await admin.page.getByLabel("Papel na empresa").selectOption("STAFF");
    await admin.page.getByRole("button", { name: "Adicionar" }).click();
    const tempPassword = (await admin.page.getByTestId("temp-password").innerText()).trim();

    await admin.page.goto("/eventos/novo");
    await admin.page.getByLabel("Nome do evento").fill(eventName);
    await admin.page.getByLabel("Início").fill("2026-12-01T18:00");
    await admin.page.getByLabel("Término").fill("2026-12-01T23:00");
    await admin.page.getByRole("button", { name: "Criar evento" }).click();
    await admin.page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
    const eventUrl = admin.page.url();
    const eventId = new URL(eventUrl).pathname.split("/").pop()!;

    await admin.page.goto(`${eventUrl}/acessos`);
    const personSelect = admin.page.getByLabel("Pessoa", { exact: true });
    await personSelect.selectOption(await personSelect.locator("option", { hasText: name }).getAttribute("value"));
    await admin.page.getByRole("button", { name: "Dar acesso" }).click();
    await expect(admin.page.getByRole("main").getByRole("status")).toContainText("Acesso concedido.");

    // ---- A pessoa entra, cria a própria senha, prepara o evento e deixa uma tarefa NÃO enviada ----
    const colleague = await newDevice(browser);
    await loginRaw(colleague.page, email, tempPassword);
    await colleague.page.waitForURL(/\/trocar-senha$/);
    const ownPassword = `Propria-senha-${stamp}`;
    await colleague.page.getByLabel("Senha provisória").fill(tempPassword);
    await colleague.page.getByLabel("Nova senha", { exact: true }).fill(ownPassword);
    await colleague.page.getByLabel("Repita a nova senha").fill(ownPassword);
    await colleague.page.getByRole("button", { name: "Salvar nova senha" }).click();
    await colleague.page.waitForURL(/\/eventos$/);

    await colleague.page.getByRole("main").locator('a[href^="/eventos/"]').filter({ hasText: eventName }).first().click();
    await colleague.page.waitForURL(/\/eventos\/[^/]+$/);
    await colleague.page.getByRole("button", { name: "Preparar evento para uso offline" }).click();
    await expect(colleague.page.getByText("Disponível offline", { exact: true })).toBeVisible({ timeout: 30_000 });

    // O aparelho ganhou identidade para o servidor: o grant offline foi pedido e guardado (antes, nenhuma tela o pedia).
    await expect.poll(async () => (await idbAll(colleague.page, "session")).length, { timeout: 15_000 }).toBe(1);

    const pendingTask = `Tarefa de campo ${stamp}`;
    await colleague.page.getByRole("link", { name: "Tarefas" }).click();
    await colleague.page.getByLabel("Nova tarefa").fill(pendingTask);
    await colleague.page.getByRole("button", { name: "Adicionar" }).click();
    await expect(colleague.page.getByText(pendingTask)).toBeVisible();
    expect(await idbAll(colleague.page, "tasks")).toHaveLength(1);
    expect(await cacheNames(colleague.page)).toContain("na-escuta-pages-v1");

    // ---- Administradora: encerra o vínculo ----
    await admin.page.goto("/administracao/equipe");
    await admin.page.getByRole("button", { name: `Encerrar o vínculo de ${name}` }).click();
    await admin.page.getByRole("button", { name: "Confirmar" }).click();
    await expect(admin.page.getByRole("main").getByRole("status")).toContainText("Vínculo encerrado");

    // ---- A pessoa abre o app de novo: sem sessão e sem poder entrar, o aparelho pergunta ao servidor com o grant ----
    await colleague.page.goto("/login");
    const notice = colleague.page.getByRole("alert").filter({ hasText: "Seu vínculo com a empresa foi encerrado." });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).not.toContainText("MEMBERSHIP_REVOKED");
    await expect(notice).toContainText("dados da empresa que estavam guardados neste aparelho foram removidos");
    await expect(notice).toContainText("1 alteração não enviada");

    // O que o servidor guarda saiu; o que só existe aqui ficou em QUARENTENA (FAILED: nenhuma sessão futura a envia).
    expect(await idbAll(colleague.page, "events")).toHaveLength(0);
    expect(await idbAll(colleague.page, "tasks")).toHaveLength(0);
    expect(await idbAll(colleague.page, "syncState")).toHaveLength(0);
    expect(await idbAll(colleague.page, "session")).toHaveLength(0);
    const kept = await idbAll(colleague.page, "outbox");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ eventId, status: "FAILED", lastError: "MEMBERSHIP_REVOKED" });
    expect((kept[0]!.payload as { title: string }).title).toBe(pendingTask);
    // O HTML dos eventos (nome e dados) saiu do cache do navegador.
    expect(await cacheNames(colleague.page)).not.toContain("na-escuta-pages-v1");

    // E não fica em laço nem volta sozinho: a página seguinte pergunta de novo e não acha grant algum.
    await colleague.page.reload();
    await expect(colleague.page.getByRole("alert").filter({ hasText: "Seu vínculo com a empresa foi encerrado." })).toBeVisible();
    expect(await idbAll(colleague.page, "outbox")).toHaveLength(1);

    // ---- Exportar a alteração: arquivo cifrado, sem a tarefa em claro ----
    await colleague.page.getByRole("button", { name: "Exportar alterações não enviadas" }).click();
    await colleague.page.getByLabel("Senha para proteger o arquivo exportado").fill("senha-do-arquivo-123");
    const downloadPromise = colleague.page.waitForEvent("download");
    await colleague.page.getByRole("button", { name: "Exportar arquivo cifrado" }).click();
    const exportedText = await readFile((await (await downloadPromise).path())!, "utf8");
    expect(exportedText).toContain("ciphertext");
    expect(exportedText).not.toContain(pendingTask);
    expect(await idbAll(colleague.page, "outbox")).toHaveLength(1); // exportar não apaga

    // ---- Remover: confirmação dizendo o que se perde, e então o aparelho fica vazio ----
    await colleague.page.getByRole("button", { name: "Remover do aparelho" }).click();
    await expect(colleague.page.getByText(/agora e para sempre/)).toBeVisible();
    await colleague.page.getByRole("button", { name: "Sim, remover do aparelho" }).click();
    await colleague.page.waitForURL(/\/login/);
    await expect(colleague.page.getByRole("alert").filter({ hasText: "Seu vínculo com a empresa foi encerrado." })).toHaveCount(0);
    for (const store of ["outbox", "events", "tasks", "syncState", "session", "deviceState"]) {
      expect(await idbAll(colleague.page, store), store).toHaveLength(0);
    }

    // Com a senha certa, entrar continua recusado (sem vínculo não há o que abrir).
    await loginRaw(colleague.page, email, ownPassword);
    await expect(colleague.page.getByText("E-mail ou senha inválidos.")).toBeVisible();

    await admin.context.close();
    await colleague.context.close();
  });

  test("redefinir a senha derruba a sessão aberta da pessoa e a obriga a criar outra", async ({ browser }) => {
    const stamp = Date.now();
    const name = `Colega redefinida ${stamp}`;
    const email = `colega.redefinida.${stamp}@naescuta.com.br`;

    // ---- Administradora: cadastra a pessoa ----
    const admin = await newDevice(browser);
    await login(admin.page);
    await admin.page.goto("/administracao/equipe");
    await admin.page.getByLabel("Nome", { exact: true }).fill(name);
    await admin.page.getByLabel("E-mail").fill(email);
    await admin.page.getByLabel("Papel na empresa").selectOption("STAFF");
    await admin.page.getByRole("button", { name: "Adicionar" }).click();
    const firstTemp = (await admin.page.getByTestId("temp-password").innerText()).trim();

    // ---- A pessoa entra, cria a própria senha e está DENTRO do app ----
    const colleague = await newDevice(browser);
    await loginRaw(colleague.page, email, firstTemp);
    await colleague.page.waitForURL(/\/trocar-senha$/);
    const ownPassword = `Propria-senha-${stamp}`;
    await colleague.page.getByLabel("Senha provisória").fill(firstTemp);
    await colleague.page.getByLabel("Nova senha", { exact: true }).fill(ownPassword);
    await colleague.page.getByLabel("Repita a nova senha").fill(ownPassword);
    await colleague.page.getByRole("button", { name: "Salvar nova senha" }).click();
    await colleague.page.waitForURL(/\/eventos$/);
    // Ainda logada depois da troca: o cookie foi reemitido (senão cairia no login agora).
    await colleague.page.reload();
    await expect(colleague.page.getByRole("main").getByText("Você ainda não tem acesso a nenhum evento.")).toBeVisible();

    // ---- Administradora: redefine a senha (aparelho perdido) ----
    await admin.page.reload();
    await admin.page.getByRole("button", { name: `Redefinir a senha de ${name}` }).click();
    await expect(admin.page.getByText(/sai de todos os aparelhos em que estiver conectada/)).toBeVisible();
    await admin.page.getByRole("button", { name: "Confirmar" }).click();
    const secondTemp = (await admin.page.getByTestId("temp-password").innerText()).trim();
    expect(secondTemp).not.toBe(firstTemp);

    // ---- A sessão aberta cai na próxima navegação ----
    await colleague.page.goto("/eventos");
    await colleague.page.waitForURL(/\/login/);

    // A senha que ela mesma criou não vale mais; a provisória nova vale e a obriga a trocar de novo.
    await loginRaw(colleague.page, email, ownPassword);
    await expect(colleague.page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await loginRaw(colleague.page, email, secondTemp);
    await colleague.page.waitForURL(/\/trocar-senha$/);

    await admin.context.close();
    await colleague.context.close();
  });

  test("quem é da equipe de campo não administra: sem link, tela recusa e a API devolve 403", async ({ page }) => {
    await login(page, FIELD_STAFF_EMAIL, PASSWORD);
    await expect(page.getByRole("navigation").getByRole("link", { name: "Equipe", exact: true })).toHaveCount(0);

    await page.goto("/administracao/equipe");
    await expect(page.getByText("Só a titularidade e a administração da empresa cuidam da equipe.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Adicionar" })).toHaveCount(0);

    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    const add = await page.request.post("/api/equipe", {
      data: { name: "Invasora", email: "invasora@x.com", role: "VIEWER" },
    });
    expect(add.status()).toBe(403);
    const change = await page.request.patch("/api/equipe/qualquer-id", { data: { status: "REVOKED" } });
    expect(change.status()).toBe(403);
    const reset = await page.request.post("/api/equipe/qualquer-id/senha");
    expect(reset.status()).toBe(403);
  });

  test("sem sessão, as rotas de equipe e de senha recusam com 401", async ({ request }) => {
    expect((await request.post("/api/equipe", { data: {} })).status()).toBe(401);
    expect((await request.patch("/api/equipe/x", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/equipe/x/senha")).status()).toBe(401);
    expect((await request.post("/api/conta/senha", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/eventos/x/acessos", { data: {} })).status()).toBe(401);
    expect((await request.patch("/api/eventos/x/acessos/y", { data: {} })).status()).toBe(401);
  });

  test("trocar a própria senha, voluntariamente, exige a atual e o formulário deixa de bloquear o app", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Trocar senha" }).click();
    await page.waitForURL(/\/trocar-senha$/);
    await expect(page.getByLabel("Senha atual")).toBeVisible();
    await expect(page.getByText(/entrou com uma senha provisória/)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Cancelar" })).toBeVisible();
  });
});

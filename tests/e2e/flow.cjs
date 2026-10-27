// Fluxo ponta a ponta no navegador contra o servidor de teste.
// Uso: node tests/e2e/flow.cjs <url-do-app> <pasta-de-capturas>
const { chromium } = require('playwright');
const [, , APP = 'http://localhost:5173', OUT = '.'] = process.argv;

const brl = (s) => s.replace(/\s/g, ' ');
function assert(cond, msg) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`ok - ${msg}`);
}

// Espera o valor esperado aparecer (os dados são revalidados em segundo plano).
async function text(page, sel, expected) {
  const deadline = Date.now() + 5000;
  let t = '';
  while (Date.now() < deadline) {
    t = brl(await page.locator(sel).first().innerText());
    if (!expected || t.includes(expected)) break;
    await page.waitForTimeout(150);
  }
  return t;
}

async function signUp(page, email) {
  await page.goto(`${APP}/cadastro`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha-segura-123');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Saldo bancário atual').waitFor();
}

async function newAccount(page, name, opening, type) {
  await page.goto(`${APP}/contas`);
  await page.getByRole('button', { name: '+ Nova conta' }).click();
  await page.getByLabel('Nome').fill(name);
  if (type) await page.getByLabel('Tipo').selectOption(type);
  await page.getByLabel('Saldo inicial (R$)').fill(opening);
  await page.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Conta cadastrada.', { exact: true }).last().waitFor();
}

async function newTx(page, { type = 'Despesa', desc, amount, situation = 'Pendente', due }) {
  await page.getByRole('button', { name: 'Novo lançamento' }).first().click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByRole('radio', { name: type }).click();
  await dlg.getByLabel('Descrição').fill(desc);
  await dlg.getByLabel('Valor (R$)').fill(amount);
  if (due) await dlg.getByLabel('Vencimento / data prevista').fill(due);
  await dlg.getByRole('radio', { name: new RegExp(`^${situation}`) }).click();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await page.getByText('Lançamento salvo.', { exact: true }).last().waitFor();
}

(async () => {
  const browser = await chromium.launch();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await mobile.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  const email = `ana+${Date.now()}@teste.local`;
  // Vencimento no próprio dia para cair sempre dentro do período "Mês atual".
  const future = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

  await signUp(page, email);
  await page.screenshot({ path: `${OUT}/01-inicio-vazio.png`, fullPage: true });

  await newAccount(page, 'Conta corrente', '4.000,00');
  await newAccount(page, 'Nubank', '0');
  await newAccount(page, 'Vale-alimentação', '600', 'benefit');
  await page.screenshot({ path: `${OUT}/02-contas.png`, fullPage: true });

  await page.goto(`${APP}/`);
  await page.getByText('Saldo bancário atual').waitFor();
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 4.000,00')).includes('R$ 4.000,00'), 'saldo inicial R$ 4.000 (VA fora do saldo livre)');

  // Teste A — despesa de 500 registrada e paga
  await newTx(page, { desc: 'Mercado', amount: '500' });
  await page.locator('section[aria-label^="A pagar"]').getByRole('button', { name: 'Pagar' }).first().click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Confirmar' }).click();
  await page.getByText('Pagamento registrado.', { exact: true }).last().waitFor();
  await page.waitForTimeout(500);
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 3.500,00')).includes('R$ 3.500,00'), 'Teste A: saldo passa a R$ 3.500 após pagar R$ 500');

  // Teste B — despesa pendente de 800
  await newTx(page, { desc: 'Aluguel', amount: '800', due: future });
  await page.waitForTimeout(500);
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 3.500,00')).includes('R$ 3.500,00'), 'Teste B: saldo bancário não muda com despesa pendente');
  const saldos = await text(page, 'section[aria-label="Saldos"]', 'R$ 2.700,00');
  assert(saldos.includes('R$ 800,00'), 'Teste B: R$ 800 aparece como comprometido');
  assert(saldos.includes('R$ 2.700,00'), 'Teste B: livre para gastar = R$ 2.700');

  // Teste C — receita prevista
  await newTx(page, { type: 'Receita', desc: 'Freela', amount: '1.500', situation: 'Prevista', due: future });
  await page.waitForTimeout(500);
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 3.500,00')).includes('R$ 3.500,00'), 'Teste C: receita prevista não altera saldo efetivo');
  assert((await text(page, 'section[aria-label="Saldos"]', 'depende de R$ 1.500,00')).includes('depende de R$ 1.500,00'), 'Teste C: projeção sinaliza receita incerta');
  await page.screenshot({ path: `${OUT}/03-inicio-celular.png`, fullPage: true });

  // Teste F — transferência
  await page.goto(`${APP}/contas`);
  await page.getByRole('button', { name: 'Transferir' }).first().click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel('De', { exact: true }).selectOption({ label: 'Conta corrente' });
  await dlg.getByLabel('Para', { exact: true }).selectOption({ label: 'Nubank' });
  await dlg.getByLabel('Valor (R$)').fill('200');
  await dlg.getByRole('button', { name: 'Transferir' }).click();
  await page.getByText('Transferência registrada.', { exact: true }).last().waitFor();
  await page.waitForTimeout(500);
  const contas = await text(page, 'main', 'R$ 3.300,00');
  assert(contas.includes('R$ 3.300,00') && contas.includes('R$ 200,00'), 'Teste F: transferência move R$ 200 entre contas');
  await page.goto(`${APP}/`);
  await page.getByText('Saldo bancário atual').waitFor();
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 3.500,00')).includes('R$ 3.500,00'), 'Teste F: total bancário inalterado');
  const despesas = await text(page, 'section[aria-label="Despesas do período"]');
  assert(despesas.includes('R$ 500,00'), 'Teste F: despesas pagas continuam R$ 500 (transferência não é despesa)');

  // Estorno e bloqueio de edição de valor
  await page.goto(`${APP}/movimentacoes`);
  await page.getByRole('button', { name: /Mercado/ }).first().click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Estornar' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: 'Estornar' }).click();
  await page.getByText('Estorno registrado.', { exact: true }).last().waitFor();
  await page.screenshot({ path: `${OUT}/04-movimentacoes.png`, fullPage: true });
  await page.goto(`${APP}/`);
  await page.getByText('Saldo bancário atual').waitFor();
  assert((await text(page, '[data-testid="saldo-bancario"]', 'R$ 4.000,00')).includes('R$ 4.000,00'), 'estorno devolve R$ 500 ao saldo e mantém histórico');

  // Teste G — outro dispositivo vê os mesmos dados, sem duplicação
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page2 = await desktop.newPage();
  await page2.goto(`${APP}/entrar`);
  await page2.getByLabel('E-mail').fill(email);
  await page2.getByLabel('Senha').fill('senha-segura-123');
  await page2.getByRole('button', { name: 'Entrar' }).click();
  await page2.getByText('Saldo bancário atual').waitFor();
  await page2.waitForTimeout(800);
  assert((await text(page2, '[data-testid="saldo-bancario"]', 'R$ 4.000,00')).includes('R$ 4.000,00'), 'Teste G: computador vê o mesmo saldo');
  await page2.screenshot({ path: `${OUT}/05-inicio-desktop.png`, fullPage: true });
  await newTx(page, { desc: 'Farmácia', amount: '35,90' });
  await page2.goto(`${APP}/movimentacoes`);
  await page2.getByText('Farmácia').waitFor();
  assert((await page2.getByText('Farmácia').count()) === 1, 'Teste G: lançamento criado no celular aparece uma única vez no computador');
  await page2.screenshot({ path: `${OUT}/06-movimentacoes-desktop.png`, fullPage: true });

  // Tema claro
  await page2.goto(`${APP}/configuracoes`);
  await page2.getByRole('radio', { name: 'Claro' }).click();
  await page2.getByText('Preferências salvas.', { exact: true }).last().waitFor();
  await page2.goto(`${APP}/`);
  await page2.getByText('Saldo bancário atual').waitFor();
  await page2.screenshot({ path: `${OUT}/07-inicio-claro.png`, fullPage: true });

  // Teste H — outro usuário não vê nada
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page3 = await other.newPage();
  await signUp(page3, `bruno+${Date.now()}@teste.local`);
  await page3.goto(`${APP}/movimentacoes`);
  await page3.getByText('Nenhum lançamento encontrado.', { exact: true }).last().waitFor();
  assert((await page3.getByText('Farmácia').count()) === 0, 'Teste H: outro usuário não vê os lançamentos');

  await browser.close();
  console.log('FLUXO COMPLETO');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

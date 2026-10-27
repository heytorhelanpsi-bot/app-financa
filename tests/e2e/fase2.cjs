// Fluxo da Fase 2 no navegador: dívidas, ordem, simulação, pagamento parcial
// (Teste D), ordem sugerida e painel do assistente (resposta simulada).
// Uso: node tests/e2e/fase2.cjs <url-do-app> <pasta-de-capturas>
const { chromium } = require('playwright');
const [, , APP = 'http://localhost:5173', OUT = '.'] = process.argv;

const brl = (s) => s.replace(/\s/g, ' ');
function assert(cond, msg) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`ok - ${msg}`);
}
async function waitText(page, sel, expected) {
  const deadline = Date.now() + 6000;
  let t = '';
  while (Date.now() < deadline) {
    t = brl(await page.locator(sel).first().innerText());
    if (t.includes(expected)) return t;
    await page.waitForTimeout(150);
  }
  return t;
}
const toast = (page, text) => page.getByText(text, { exact: true }).last().waitFor();

async function newDebt(page, { creditor, outstanding, installment, consequence, essential, priority }) {
  await page.getByRole('button', { name: '+ Nova dívida' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel('Credor').fill(creditor);
  await dlg.getByLabel('Saldo devedor hoje (R$)').fill(outstanding);
  if (installment) await dlg.getByLabel('Parcela (R$)').fill(installment);
  if (priority) await dlg.getByRole('radio', { name: priority }).click();
  if (consequence) await dlg.getByLabel('Se atrasar, o que acontece?').selectOption({ label: consequence });
  if (essential) await dlg.getByText('Conta essencial').click();
  await dlg.getByRole('button', { name: 'Salvar' }).click();
  await toast(page, 'Dívida cadastrada.');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));

  await page.goto(`${APP}/cadastro`);
  await page.getByLabel('E-mail').fill(`d${Date.now()}@teste.local`);
  await page.getByLabel('Senha').fill('senha-segura-123');
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Saldo bancário atual').waitFor();

  await page.goto(`${APP}/contas`);
  await page.getByRole('button', { name: '+ Nova conta' }).click();
  await page.getByLabel('Nome').fill('Conta salário');
  await page.getByLabel('Saldo inicial (R$)').fill('3.000');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await toast(page, 'Conta cadastrada.');

  await page.goto(`${APP}/ordem-de-pagamento`);
  await page.getByRole('button', { name: '+ Nova dívida' }).waitFor();
  await newDebt(page, { creditor: 'Banco X', outstanding: '2.000', installment: '500', consequence: 'Juros altos', priority: 'Média' });
  await newDebt(page, { creditor: 'Irmã', outstanding: '600', consequence: 'Dívida com pessoa (não pode atrasar)', priority: 'Alta' });
  await newDebt(page, { creditor: 'Energia', outstanding: '250', consequence: 'Corte de serviço essencial', essential: true, priority: 'Crítica' });

  const total = await waitText(page, 'main', 'R$ 2.850,00');
  assert(total.includes('R$ 2.850,00'), 'total em dívidas soma R$ 2.850');
  await page.screenshot({ path: `${OUT}/f2-01-ordem-manual.png`, fullPage: true });

  // Ordem manual: subir "Energia" (3ª) para 2ª com o botão acessível
  await page.getByRole('button', { name: 'Subir Energia' }).click();
  await toast(page, 'Ordem salva.');
  const cards = await page.locator('article').allInnerTexts();
  assert(cards[1].includes('Energia'), 'botão subir reordena e salva a ordem manual');

  // Simulação com pouco dinheiro: nada muda no saldo real
  await page.getByLabel('Dinheiro disponível para as dívidas (R$)').fill('700');
  const sim = await waitText(page, 'section[aria-label="Simulação"]', 'Faltam');
  assert(sim.includes('Faltam'), 'simulação mostra o que falta quando o dinheiro não cobre tudo');
  assert((await page.getByText('Fica pendente').count()) >= 1, 'simulação indica contas que ficam pendentes');

  // Sugestão automática: essencial e dívida com pessoa antes do banco
  await page.getByRole('tab', { name: 'Sugestão' }).click();
  const sug = await page.locator('article').allInnerTexts();
  assert(sug[0].includes('Energia') && sug[sug.length - 1].includes('Banco X'), 'ordem sugerida prioriza essencial e pessoa, com o banco por último');
  assert(sug[0].includes('Por quê:'), 'sugestão explica o motivo');
  await page.screenshot({ path: `${OUT}/f2-02-sugerida.png`, fullPage: true });
  await page.getByRole('tab', { name: 'Minha ordem' }).click();

  // Teste D: pagamento parcial de R$ 500 no Banco X
  const banco = page.locator('article', { hasText: 'Banco X' });
  await banco.getByRole('button', { name: 'Pagar' }).click();
  const dlg = page.locator('dialog[open]');
  await dlg.getByLabel('Valor pago (R$)').fill('500');
  await dlg.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await toast(page, 'Pagamento registrado.');
  const after = await waitText(page, 'article:has-text("Banco X")', 'R$ 1.500,00');
  assert(after.includes('R$ 1.500,00'), 'Teste D: dívida de R$ 2.000 passa a R$ 1.500 após pagar R$ 500');

  await page.goto(`${APP}/contas`);
  const contas = await waitText(page, 'main', 'R$ 2.500,00');
  assert(contas.includes('R$ 2.500,00'), 'Teste D: saída de R$ 500 registrada na conta usada');

  // Início mostra a projeção e as parcelas
  await page.goto(`${APP}/`);
  await page.getByText('Saldo dia a dia').waitFor();
  assert((await page.getByRole('img', { name: 'Saldo projetado por dia' }).count()) === 1, 'tela inicial mostra o gráfico de projeção do saldo');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/f2-03-inicio.png`, fullPage: true });

  // Assistente: pede consentimento, depois analisa (resposta simulada no servidor de teste)
  await page.goto(`${APP}/ordem-de-pagamento`);
  await page.getByRole('tab', { name: 'Assistente IA' }).click();
  await page.getByRole('link', { name: 'Ativar e completar meu perfil' }).click();
  await page.getByLabel('Ocupação').fill('Servidor público');
  await page.getByLabel('Dias em que recebe').fill('5, 20');
  await page.getByLabel('Sua situação, com suas palavras').fill('Uso o limite do cartão na maquininha para ter dinheiro.');
  await page.getByText('Permitir análise por IA').click();
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await toast(page, 'Perfil financeiro salvo.');
  await page.goto(`${APP}/ordem-de-pagamento`);
  await page.getByRole('tab', { name: 'Assistente IA' }).click();
  await page.getByRole('button', { name: 'Analisar minha situação' }).click();
  await page.getByText('Plano passo a passo').waitFor();
  assert((await page.getByText('[TESTE] posição 1').count()) === 1, 'painel exibe a ordem e os motivos devolvidos pelo assistente');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/f2-04-assistente.png`, fullPage: true });

  await browser.close();
  console.log('FLUXO FASE 2 COMPLETO');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

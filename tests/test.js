// Testes do Code.gs rodando no Node com uma planilha simulada.
// Uso: node tests/test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---------- Simulação mínima dos serviços do Apps Script ---------- */
function criarAmbiente(hojeISO, abas) {
  const enviados = [];
  const emails = [];
  const cache = {};
  const fmt = (d, tz, pattern) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day)
      .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const sheet = (linhas) => ({
    getDataRange: () => ({ getValues: () => linhas.map((l) => l.slice()) }),
    appendRow: (l) => linhas.push(l),
    getRange: (linha, coluna) => ({ setValue: (v) => { linhas[linha - 1][coluna - 1] = v; } }),
  });
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(`${hojeISO}T12:00:00-03:00`); }
  }
  const ctx = {
    console: { warn: () => {}, error: () => {}, log: console.log },
    Date: FakeDate,
    Utilities: { formatDate: fmt },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (n) => (abas[n] ? sheet(abas[n]) : null),
        getSpreadsheetTimeZone: () => 'America/Sao_Paulo',
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => ({ CALLMEBOT_PHONE: '+5518998051878', CALLMEBOT_APIKEY: '123' })[k] }),
    },
    UrlFetchApp: {
      fetch: (url) => { enviados.push(decodeURIComponent(url.match(/text=([^&]*)/)[1])); return { getResponseCode: () => 200 }; },
    },
    MailApp: { sendEmail: (m) => emails.push(m) },
    CacheService: {
      getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }),
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  ctx.enviados = enviados;
  ctx.emails = emails;
  return ctx;
}

// tempoMs simula a pessoa levando 5 s entre abrir a página e enviar.
const DADOS_CLIENTE = {
  nome: 'Maria Silva', endereco: 'Rua das Flores, 123, Centro', tempoMs: 5000, campo_extra: '',
  veiculo: 'carro', servico: 'completa', adicional: false,
};
const post = (g, body) => g.doPost({ postData: { contents: JSON.stringify({ ...DADOS_CLIENTE, ...body }) } });
let total = 0;
const teste = (nome, fn) => { fn(); total++; console.log('ok -', nome); };

/* ------------------------------ Testes ------------------------------ */

teste('crc16 bate com o valor de referência CCITT-FALSE', () => {
  const g = criarAmbiente('2026-10-19', {});
  assert.strictEqual(g.crc16('123456789'), '29B1');
});

teste('Pix copia e cola tem estrutura e CRC válidos', () => {
  const g = criarAmbiente('2026-10-19', {});
  const pix = g.gerarPix('+5518998051878', 20, 'Pedro Rotta', 'São Paulo');
  assert.ok(pix.startsWith('000201'));
  assert.ok(pix.includes('0014br.gov.bcb.pix0114+5518998051878'));
  assert.ok(pix.includes('540520.00'));
  assert.ok(pix.includes('5911PEDRO ROTTA6009SAO PAULO'));
  assert.strictEqual(g.crc16(pix.slice(0, -4)), pix.slice(-4));
  // Percorre os campos TLV e confere que os tamanhos fecham exatamente.
  let i = 0;
  while (i < pix.length) { const n = Number(pix.substr(i + 2, 2)); i += 4 + n; }
  assert.strictEqual(i, pix.length);
});

teste('slots: só ter/qua/qui, começam amanhã e vão até 21 dias', () => {
  const g = criarAmbiente('2026-10-20', {}); // terça
  const horarios = [{ diaSemana: 2, horario: '09:00' }, { diaSemana: 3, horario: '14:00' }, { diaSemana: 4, horario: '17:00' }];
  const slots = g.calcularSlots('2026-10-20', horarios, ['2026-10-22 17:00'], 21);
  assert.ok(!slots.some((s) => s.data === '2026-10-20'), 'não pode reservar no mesmo dia');
  assert.strictEqual(slots[0].data, '2026-10-21');
  assert.ok(!slots.some((s) => s.data === '2026-10-22'), 'horário ocupado some');
  assert.strictEqual(slots[slots.length - 1].data, '2026-11-10'); // terça, dia 21
  assert.strictEqual(slots.length, 8);
});

teste('telefone: normaliza formatos e rejeita inválidos', () => {
  const g = criarAmbiente('2026-10-19', {});
  assert.strictEqual(g.normalizarTelefone('(18) 99805-1878'), '18998051878');
  assert.strictEqual(g.normalizarTelefone('+55 18 99805-1878'), '18998051878');
  assert.strictEqual(g.normalizarTelefone('1832221234'), '1832221234');
  assert.strictEqual(g.normalizarTelefone('12345'), '');
  assert.strictEqual(g.normalizarTelefone('18123456789'), '');
});

teste('fluxo: cliente novo fica aguardando sinal, recebe Pix e bloqueia o horário', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim'], ['Quarta-feira', '14:00', 'sim'], ['quinta', '17:00', 'não']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em']],
  };
  const g = criarAmbiente('2026-10-19', abas); // segunda
  const antes = g.doGet();
  assert.ok(antes.ok);
  assert.ok(!antes.slots.some((s) => s.horario === '17:00'), 'horário inativo não aparece');
  assert.deepStrictEqual({ ...antes.slots[0] }, { data: '2026-10-20', horario: '09:00' });

  const r = post(g, { data: '2026-10-20', horario: '09:00', telefone: '(18) 99999-0000' });
  assert.strictEqual(r.status, 'aguardando sinal');
  assert.strictEqual(r.recorrente, false);
  assert.strictEqual(r.pix.valor, 20);
  assert.ok(g.enviados[0].includes('NOVO CLIENTE'));
  assert.deepStrictEqual(Array.from(abas.Reservas[1]).slice(0, 4), ['2026-10-20', '09:00', '18999990000', 'aguardando sinal']);

  const depois = g.doGet();
  assert.ok(!depois.slots.some((s) => s.data === '2026-10-20' && s.horario === '09:00'));

  const dup = post(g, { data: '2026-10-20', horario: '09:00', telefone: '18988887777' });
  assert.strictEqual(dup.ok, false, 'não permite reserva duplicada');

  const segunda = post(g, { data: '2026-10-21', horario: '14:00', telefone: '18999990000' });
  assert.strictEqual(segunda.ok, false, 'cliente novo não segura dois horários sem pagar');
});

teste('fluxo: cliente recorrente é confirmado direto, sem Pix', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim'], ['quarta', '14:00', 'sim']],
    // Datas/horas vindas como Date (como o Sheets faz quando a coluna não é texto)
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em'],
      [new Date('2026-10-01T03:00:00Z'), new Date('1899-12-30T12:06:28Z'), 18999990000, 'Confirmada', '']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { data: '2026-10-21', horario: '14:00', telefone: '+55 (18) 99999-0000' });
  assert.strictEqual(r.status, 'confirmada');
  assert.strictEqual(r.pix, undefined);
  assert.ok(g.enviados[0].includes('confirmada'));
  assert.ok(!g.enviados[0].includes('NOVO CLIENTE'));
});

teste('cancelada libera o horário', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '09:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em'], ['2026-10-20', '09:00', '18999990000', 'cancelada', '']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.ok(g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '09:00'));
});

teste('horário: aceita janelas e normaliza formatos', () => {
  const g = criarAmbiente('2026-10-19', {});
  assert.strictEqual(g.normalizarHorario('8:00-11:00'), '08:00-11:00');
  assert.strictEqual(g.normalizarHorario('13h00 às 16h00'), '13:00-16:00');
  assert.strictEqual(g.normalizarHorario('9:00'), '09:00');
  assert.strictEqual(g.normalizarHorario('manhã'), '');
  assert.strictEqual(g.descreverHorario('08:00-11:00'), 'das 08:00 às 11:00');
});

teste('fluxo com janelas: grava nome e endereço e avisa com mapa', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim'], ['terça', '13:00 às 16:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.deepStrictEqual(g.doGet().slots.filter((s) => s.data === '2026-10-20').map((s) => s.horario), ['08:00-11:00', '13:00-16:00']);

  const r = post(g, { data: '2026-10-20', horario: '13:00-16:00', telefone: '18999990000',
    nome: '  João   Souza ', endereco: 'Av. Brasil, 500, Jardim Paulista' });
  assert.strictEqual(r.ok, true);
  const linha = Array.from(abas.Reservas[1]);
  assert.deepStrictEqual([linha[1], linha[5], linha[6]], ['13:00-16:00', 'João Souza', 'Av. Brasil, 500, Jardim Paulista']);
  const msg = g.enviados[0];
  assert.ok(msg.includes('das 13:00 às 16:00'));
  assert.ok(msg.includes('João Souza'));
  assert.ok(msg.includes('https://maps.google.com/?q=Av.%20Brasil'));
  assert.ok(!g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '13:00-16:00'), 'janela reservada some');
  assert.strictEqual(g.emails.length, 1, 'manda e-mail de aviso');
  assert.strictEqual(g.emails[0].to, 'pedrorotta2006@gmail.com');
  assert.strictEqual(g.emails[0].subject, '🆕 NOVO CLIENTE: João Souza, terça 20/10 13:00-16:00');
  assert.strictEqual(g.emails[0].body, msg);
});

teste('nome e endereço: obrigatórios e sem virar fórmula na planilha', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  const base = { data: '2026-10-20', horario: '08:00-11:00', telefone: '18999990000' };
  assert.strictEqual(post(g, { ...base, nome: '' }).ok, false);
  assert.strictEqual(post(g, { ...base, endereco: 'Rua' }).ok, false);
  assert.strictEqual(abas.Reservas.length, 1, 'nada gravado com dados inválidos');

  post(g, { ...base, nome: '=HYPERLINK("x")', endereco: '+55 Rua X, 10' });
  const linha = Array.from(abas.Reservas[1]);
  assert.strictEqual(linha[5], "'=HYPERLINK(\"x\")");
  assert.strictEqual(linha[6], "'+55 Rua X, 10");
});

const abasSimples = () => ({
  Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim']],
  Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
});
const BASE = { data: '2026-10-20', horario: '08:00-11:00', telefone: '18999990000' };

teste('anti-bot: campo-armadilha preenchido é recusado sem gravar nem avisar', () => {
  const abas = abasSimples();
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { ...BASE, campo_extra: 'http://spam.example' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(abas.Reservas.length, 1, 'nada gravado');
  assert.strictEqual(g.emails.length, 0, 'nenhum aviso');
  assert.strictEqual(post(g, { ...BASE, campo_extra: '   ' }).ok, true, 'só espaços não conta como preenchido');
});

teste('anti-bot: envio rápido demais ou sem tempo é recusado; 3000 ms passa', () => {
  const g = criarAmbiente('2026-10-19', abasSimples());
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 2999 }, 3000), 'rapido');
  assert.strictEqual(g.motivoAntiBot({}, 3000), 'rapido', 'sem tempoMs (chamada direta à API)');
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 'abc' }, 3000), 'rapido');
  assert.strictEqual(g.motivoAntiBot({ tempoMs: 3000 }, 3000), '');
  assert.strictEqual(post(g, { ...BASE, tempoMs: 800 }).ok, false);
  assert.strictEqual(post(g, { ...BASE, tempoMs: 3000 }).ok, true);
});

const comPendentes = (n) => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim'], ['quarta', '08:00-11:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço']],
  };
  // n pendentes em datas passadas, para não ocupar as janelas testadas
  for (let i = 0; i < n; i++) abas.Reservas.push(['2026-10-0' + (i + 1), '08:00-11:00', '1899999000' + i, 'aguardando sinal', '', 'Bot', 'Rua X, 1']);
  return abas;
};

teste('teto: com 6 pendentes, cliente novo é recusado e alerta sai uma vez só', () => {
  const abas = comPendentes(6);
  const g = criarAmbiente('2026-10-19', abas);
  assert.strictEqual(g.contarPendentes(g.lerReservas_()), 6);
  const r1 = post(g, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18911112222' });
  const r2 = post(g, { data: '2026-10-21', horario: '08:00-11:00', telefone: '18933334444' });
  assert.strictEqual(r1.ok, false);
  assert.ok(r1.erro.includes('WhatsApp'), 'manda o cliente para o WhatsApp');
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(abas.Reservas.length, 7, 'nada gravado');
  assert.strictEqual(g.emails.length, 1, 'um alerta só');
  assert.ok(g.emails[0].subject.includes('Limite de reservas pendentes'));
});

teste('teto: com 5 pendentes ainda aceita; recorrente passa mesmo com teto atingido', () => {
  const g5 = criarAmbiente('2026-10-19', comPendentes(5));
  assert.strictEqual(post(g5, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18911112222' }).ok, true);

  const abas = comPendentes(6);
  abas.Reservas.push(['2026-09-01', '08:00-11:00', '18955556666', 'confirmada', '', 'Cliente fiel', 'Rua Y, 2']);
  const g = criarAmbiente('2026-10-19', abas);
  const r = post(g, { data: '2026-10-20', horario: '08:00-11:00', telefone: '18955556666' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.status, 'confirmada');
});

teste('expiração: só "aguardando sinal" com mais de 12 h vira cancelada', () => {
  const abas = {
    Horarios: [['Dia', 'Horário', 'Ativo'], ['terça', '08:00-11:00', 'sim'], ['terça', '13:00-16:00', 'sim']],
    Reservas: [['Data', 'Horário', 'Telefone', 'Status', 'Criado em', 'Nome', 'Endereço'],
      ['2026-10-20', '08:00-11:00', '18911110000', 'aguardando sinal', '2026-10-18 23:00:00', 'Velho', 'Rua A, 1'],   // 13 h → expira
      ['2026-10-20', '13:00-16:00', '18922220000', 'aguardando sinal', '2026-10-19 01:00:00', 'Recente', 'Rua B, 2'], // 11 h → fica
      ['2026-10-27', '08:00-11:00', '18933330000', 'confirmada', '2026-10-01 10:00:00', 'Pago', 'Rua C, 3'],          // confirmada → fica
      ['2026-10-27', '13:00-16:00', 'bloqueio', 'aguardando sinal', '', '', ''],                                      // sem data → fica
      ['2026-10-28', '08:00-11:00', '18944440000', 'cancelada', '2026-10-01 10:00:00', 'Antigo', 'Rua D, 4']],       // já cancelada
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.ok(!g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '08:00-11:00'), 'antes: ocupada');

  g.expirarSinais();

  assert.deepStrictEqual(abas.Reservas.slice(1).map((l) => l[3]),
    ['cancelada', 'aguardando sinal', 'confirmada', 'aguardando sinal', 'cancelada']);
  assert.ok(g.doGet().slots.some((s) => s.data === '2026-10-20' && s.horario === '08:00-11:00'), 'depois: janela volta');
  assert.strictEqual(g.emails.length, 1, 'avisa o dono');
  assert.ok(g.emails[0].body.includes('Velho'));
  assert.ok(g.emails[0].body.includes('já pagou'), 'orienta o dono se alguém pagou e não foi marcado');

  g.expirarSinais();
  assert.strictEqual(g.emails.length, 1, 'sem nada novo, não manda e-mail');
});

teste('Pix informa o prazo de pagamento do sinal', () => {
  const g = criarAmbiente('2026-10-19', abasSimples());
  const r = post(g, BASE);
  assert.strictEqual(r.pix.prazoHoras, 12);
});

teste('serviço: soma o adicional pelo preço do veículo e recusa escolhas inválidas', () => {
  const g = criarAmbiente('2026-10-19', {});
  const tabela = g.lerServicos_(); // sem aba Servicos → tabela padrão
  assert.strictEqual(g.calcularPedido(tabela, 'carro', 'externa', false).valor, 30);
  assert.strictEqual(g.calcularPedido(tabela, 'carro', 'interna', true).valor, 50);
  assert.strictEqual(g.calcularPedido(tabela, 'camionete', 'completa', true).valor, 110);
  assert.strictEqual(g.calcularPedido(tabela, 'camionete', 'completa', 'sim').adicional, true);
  assert.strictEqual(g.calcularPedido(tabela, 'moto', 'completa', false), null);
  assert.strictEqual(g.calcularPedido(tabela, 'carro', 'adicional', false), null, 'adicional sozinho não é serviço');
  assert.strictEqual(g.calcularPedido(tabela, 'carro', 'polimento', false), null);
  assert.strictEqual(g.calcularPedido(tabela, 'carro', '', false), null);
});

teste('serviço: preços vêm da aba Servicos e são gravados na reserva', () => {
  const abas = {
    ...abasSimples(),
    Servicos: [['Código', 'Nome', 'Carro', 'Camionete'],
      ['externa', 'Só por fora', 32, 47], ['completa', 'Completa', 65, 95], ['adicional', 'Extra', 18, 22],
      ['interna', 'Sem preço', '', '']],
  };
  const g = criarAmbiente('2026-10-19', abas);
  assert.deepStrictEqual(g.doGet().servicos.map((s) => s.codigo), ['externa', 'completa', 'adicional'], 'linha sem preço some');

  assert.strictEqual(post(g, { ...BASE, servico: 'interna' }).ok, false, 'serviço sem preço não pode ser reservado');
  assert.strictEqual(post(g, { ...BASE, veiculo: '' }).ok, false, 'veículo obrigatório');
  assert.strictEqual(abas.Reservas.length, 1, 'nada gravado');

  const r = post(g, { ...BASE, veiculo: 'camionete', servico: 'externa', adicional: true, valor: 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.valor, 69, 'valor calculado no servidor, ignora o que veio da página');
  assert.strictEqual(r.servico, 'Camionete · Só por fora + adicional · R$ 69');
  assert.deepStrictEqual(Array.from(abas.Reservas[1]).slice(7), ['Camionete', 'Só por fora', 'sim', 69]);
  assert.ok(g.emails[0].body.includes('🚗 Camionete · Só por fora + adicional · R$ 69'));
});

teste('serviço: sem a aba Servicos usa a tabela padrão', () => {
  const g = criarAmbiente('2026-10-19', abasSimples());
  assert.strictEqual(g.doGet().servicos.length, 4);
  assert.strictEqual(post(g, BASE).valor, 60);
});

console.log(`\n${total} testes passaram.`);

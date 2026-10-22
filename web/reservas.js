// URL do Web App do Google Apps Script (termina em /exec). Veja docs/CONFIGURACAO.md.
const RESERVAS_API_URL = 'https://script.google.com/macros/s/AKfycbyEcxBLa9EBoq2MljwwEfN1xBydNvZlqYwuxKa8VU69zC9UY3wGCvTImSpSDoUZAU4W5w/exec';

(function () {
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const $ = (id) => document.getElementById(id);

  const form = $('reservas-form');
  const servicosEl = $('reservas-servicos');
  const slotsEl = $('reservas-slots');
  const telefoneEl = $('reservas-telefone');
  const nomeEl = $('reservas-nome');
  const enderecoEl = $('reservas-endereco');
  const botao = $('reservas-botao');
  const erroEl = $('reservas-erro');

  const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Abra a página com ?demo no final da URL para ver o fluxo com dados de exemplo.
  // Telefone terminado em 1111 simula cliente recorrente.
  const DEMO = new URLSearchParams(location.search).has('demo');

  // Anti-bot: o script recusa envios feitos menos de 3 s depois de a página abrir.
  const carregadaEm = Date.now();

  async function chamarApi(opcoes) {
    if (DEMO) return apiDemo(opcoes);
    if (!RESERVAS_API_URL) throw new Error('sem-url');
    const res = await fetch(RESERVAS_API_URL, opcoes);
    return res.json();
  }

  function apiDemo(opcoes) {
    if (!opcoes) {
      const slots = [];
      for (let i = 1; i <= 21; i++) {
        const d = new Date(Date.now() + i * 864e5);
        if ([2, 3, 4].includes(d.getDay())) {
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          ['08:00-11:00', '13:00-16:00'].forEach((horario) => slots.push({ data: iso, horario }));
        }
      }
      return { ok: true, valorSinal: 20, servicos: SERVICOS_DEMO, slots };
    }
    const b = JSON.parse(opcoes.body);
    const recorrente = b.telefone.replace(/\D/g, '').endsWith('1111');
    const pedido = { servico: descreverEscolha(SERVICOS_DEMO, b), valor: valorEscolha(SERVICOS_DEMO, b) };
    return recorrente
      ? { ok: true, status: 'confirmada', recorrente, data: b.data, horario: b.horario, ...pedido }
      : { ok: true, status: 'aguardando sinal', recorrente, data: b.data, horario: b.horario, ...pedido,
          pix: { valor: 20, copiaECola: 'DEMONSTRACAO-SEM-VALOR-PIX-REAL', prazoHoras: 12 } };
  }

  const SERVICOS_DEMO = [
    { codigo: 'externa', nome: 'Lavagem externa', precos: { carro: 30, camionete: 45 } },
    { codigo: 'interna', nome: 'Lavagem interna', precos: { carro: 35, camionete: 50 } },
    { codigo: 'completa', nome: 'Lavagem completa', precos: { carro: 60, camionete: 90 } },
    { codigo: 'adicional', nome: 'Adicional (pneus, plásticos e vidros)', precos: { carro: 15, camionete: 20 } },
  ];

  const VEICULOS = { carro: 'Carro', camionete: 'Camionete' };
  let servicos = [];

  // Escolha atual do formulário: { veiculo, servico, adicional }.
  function escolha() {
    const v = form.querySelector('input[name="veiculo"]:checked');
    const s = form.querySelector('input[name="servico"]:checked');
    const a = form.querySelector('input[name="adicional"]');
    return { veiculo: v ? v.value : '', servico: s ? s.value : '', adicional: !!(a && a.checked) };
  }

  function valorEscolha(lista, e) {
    const s = lista.find((x) => x.codigo === e.servico);
    const extra = e.adicional && lista.find((x) => x.codigo === 'adicional');
    if (!s || !VEICULOS[e.veiculo]) return 0;
    return s.precos[e.veiculo] + (extra ? extra.precos[e.veiculo] : 0);
  }

  function descreverEscolha(lista, e) {
    const s = lista.find((x) => x.codigo === e.servico);
    return `${VEICULOS[e.veiculo]} · ${s.nome}${e.adicional ? ' + adicional' : ''} · ${reais(valorEscolha(lista, e))}`;
  }

  function rotuloData(iso) {
    const [a, m, d] = iso.split('-').map(Number);
    const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
    return `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
  }

  // "08:00-11:00" → "08:00 às 11:00"
  const rotuloHorario = (h) => h.replace('-', ' às ');

  function mostrarErro(msg) {
    erroEl.textContent = msg || '';
    erroEl.hidden = !msg;
  }

  function atualizarBotao() {
    const temServico = !!escolha().servico;
    const temHorario = !!form.querySelector('input[name="slot"]:checked');
    const digitos = telefoneEl.value.replace(/\D/g, '');
    const nomeOk = nomeEl.value.trim().length >= 2;
    const enderecoOk = enderecoEl.value.trim().length >= 5;
    botao.disabled = !(temServico && temHorario && digitos.length >= 10 && nomeOk && enderecoOk);
  }

  // Pílula de escolha (mesmo visual dos horários): <label><input type=radio|checkbox><span>texto</span></label>
  function opcao(tipo, name, value, texto) {
    const label = document.createElement('label');
    label.className = 'reservas-hora';
    const input = document.createElement('input');
    input.type = tipo;
    input.name = name;
    input.value = value;
    const span = document.createElement('span');
    span.textContent = texto;
    label.append(input, span);
    return label;
  }

  function grupo(titulo, ...itens) {
    const bloco = document.createElement('div');
    bloco.className = 'reservas-dia';
    const h = document.createElement('h4');
    h.textContent = titulo;
    const lista = document.createElement('div');
    lista.className = 'reservas-horas';
    lista.append(...itens);
    bloco.append(h, lista);
    return bloco;
  }

  function renderizarServicos(lista) {
    servicos = lista;
    servicosEl.innerHTML = '';
    const principais = lista.filter((s) => s.codigo !== 'adicional');
    const extra = lista.find((s) => s.codigo === 'adicional');

    const veiculos = Object.keys(VEICULOS).map((v) => opcao('radio', 'veiculo', v, VEICULOS[v]));
    veiculos[0].querySelector('input').checked = true;
    const opcoesServico = principais.map((s) => opcao('radio', 'servico', s.codigo, ''));
    servicosEl.append(grupo('Veículo', ...veiculos), grupo('Serviço', ...opcoesServico));

    let opcaoExtra = null;
    if (extra) {
      opcaoExtra = opcao('checkbox', 'adicional', 'sim', '');
      servicosEl.append(grupo('Adicional', opcaoExtra));
      const desc = document.createElement('p');
      desc.className = 'reservas-info';
      desc.textContent = 'Pneus detalhados, plásticos renovados e vidros tratados.';
      servicosEl.append(desc);
    }

    const totalEl = document.createElement('p');
    totalEl.className = 'reservas-total';
    servicosEl.append(totalEl);

    // Preços mudam conforme o veículo.
    const atualizarPrecos = () => {
      const e = escolha();
      principais.forEach((s, i) => {
        opcoesServico[i].querySelector('span').textContent = `${s.nome} · ${reais(s.precos[e.veiculo])}`;
      });
      if (opcaoExtra) opcaoExtra.querySelector('span').textContent = `Quero o adicional · + ${reais(extra.precos[e.veiculo])}`;
      totalEl.textContent = e.servico ? `Total: ${reais(valorEscolha(servicos, e))}` : '';
      atualizarBotao();
    };
    servicosEl.querySelectorAll('input').forEach((i) => i.addEventListener('change', atualizarPrecos));
    atualizarPrecos();
  }

  nomeEl.addEventListener('input', atualizarBotao);
  enderecoEl.addEventListener('input', atualizarBotao);

  // Máscara simples: (18) 99999-9999
  telefoneEl.addEventListener('input', () => {
    const d = telefoneEl.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    telefoneEl.value = v;
    atualizarBotao();
  });

  function renderizarSlots(slots) {
    slotsEl.innerHTML = '';
    if (!slots.length) {
      slotsEl.innerHTML = '<p class="reservas-info">Nenhum horário disponível nas próximas semanas.</p>';
      return;
    }
    const porDia = {};
    slots.forEach((s) => (porDia[s.data] = porDia[s.data] || []).push(s.horario));

    Object.keys(porDia).sort().forEach((data) => {
      const bloco = document.createElement('div');
      bloco.className = 'reservas-dia';
      const titulo = document.createElement('h4');
      titulo.textContent = rotuloData(data);
      const horas = document.createElement('div');
      horas.className = 'reservas-horas';

      porDia[data].forEach((horario) => {
        const label = opcao('radio', 'slot', `${data}|${horario}`, rotuloHorario(horario));
        label.querySelector('input').addEventListener('change', atualizarBotao);
        horas.appendChild(label);
      });

      bloco.append(titulo, horas);
      slotsEl.appendChild(bloco);
    });
  }

  async function carregarSlots() {
    slotsEl.innerHTML = '<p class="reservas-info">Carregando horários…</p>';
    atualizarBotao();
    try {
      const json = await chamarApi();
      if (!json.ok) throw new Error(json.erro);
      // Mantém a escolha de serviço quando os horários são recarregados (ex.: depois de um erro).
      if (!servicos.length) renderizarServicos(json.servicos || []);
      renderizarSlots(json.slots);
    } catch (e) {
      if (!servicos.length) servicosEl.innerHTML = '';
      slotsEl.innerHTML = e.message === 'sem-url'
        ? '<p class="reservas-info">As reservas pelo site estarão disponíveis em breve. Enquanto isso, chame no <a href="https://wa.me/5518998051878" target="_blank" rel="noopener">WhatsApp</a>.</p>'
        : '<p class="reservas-erro">Não foi possível carregar os horários. Tente novamente mais tarde.</p>';
    }
  }

  function mostrarResultado(r) {
    form.hidden = true;
    $('reservas-resultado').hidden = false;
    const quando = r.horario.includes('-')
      ? `${rotuloData(r.data)}, das ${rotuloHorario(r.horario)}`
      : `${rotuloData(r.data)} às ${r.horario}`;
    $('reservas-servico-escolhido').textContent = r.servico ? `Serviço: ${r.servico}` : '';

    if (r.recorrente) {
      $('reservas-titulo').textContent = 'Reserva confirmada!';
      $('reservas-detalhe').textContent = `Te espero na ${quando}.`;
      $('reservas-pix').hidden = true;
      return;
    }

    $('reservas-titulo').textContent = 'Horário reservado — falta o sinal';
    $('reservas-detalhe').textContent = `Seu horário: ${quando}.`;
    $('reservas-pix-valor').textContent = reais(r.pix.valor);
    $('reservas-copia-cola').value = r.pix.copiaECola;
    if (r.pix.prazoHoras) {
      $('reservas-prazo').textContent =
        `Pague o sinal em até ${r.pix.prazoHoras} horas. Depois disso, o horário é liberado automaticamente.`;
    }
    const qr = $('reservas-qrcode');
    qr.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qr, { text: r.pix.copiaECola, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
    }
    $('reservas-pix').hidden = false;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mostrarErro('');
    const marcado = form.querySelector('input[name="slot"]:checked');
    if (!marcado) return mostrarErro('Escolha um horário.');
    const [data, horario] = marcado.value.split('|');

    botao.disabled = true;
    botao.textContent = 'Reservando…';
    try {
      // Corpo como texto simples evita o "preflight" de CORS, que o Apps Script não suporta.
      const json = await chamarApi({
        method: 'POST',
        body: JSON.stringify({
          data, horario, telefone: telefoneEl.value, nome: nomeEl.value, endereco: enderecoEl.value, ...escolha(),
          tempoMs: Date.now() - carregadaEm, campo_extra: $('reservas-campo-extra').value,
        }),
      });
      if (!json.ok) {
        mostrarErro(json.erro);
        carregarSlots();
        return;
      }
      mostrarResultado(json);
    } catch (e) {
      mostrarErro('Falha de conexão. Verifique sua internet e tente novamente.');
    } finally {
      botao.textContent = 'Reservar';
      atualizarBotao();
    }
  });

  $('reservas-copiar').addEventListener('click', async () => {
    const campo = $('reservas-copia-cola');
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch (e) {
      campo.select();
      document.execCommand('copy');
    }
    $('reservas-copiar').textContent = 'Código copiado!';
    setTimeout(() => ($('reservas-copiar').textContent = 'Copiar código Pix'), 2500);
  });

  $('reservas-nova').addEventListener('click', () => {
    $('reservas-resultado').hidden = true;
    form.hidden = false;
    form.reset();
    servicos = []; // redesenha a escolha de serviço do zero
    carregarSlots();
  });

  // Os horários não ficam na página: só são buscados quando o cliente clica em Reservar.
  let aberto = false;
  function abrirReservas() {
    if (aberto) return;
    aberto = true;
    $('reservas-inicio').hidden = true;
    form.hidden = false;
    carregarSlots();
  }

  $('reservas-abrir').addEventListener('click', abrirReservas);
  // Links "Reservar" do topo (e o "pular para as reservas") também abrem o formulário.
  document.querySelectorAll('a[href="#reservas"]').forEach((a) => a.addEventListener('click', abrirReservas));
})();

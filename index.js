// index.js
const express   = require('express');
const cors      = require('cors');
const fs        = require('fs');
const path      = require('path');
const puppeteer = require('puppeteer');
const schedule  = require('node-schedule');

const app          = express();
const PORT         = process.env.PORT || 3000;
const SON_LIMIT    = 108;
const PAGE_DELAY   = 500;      // ms entre páginas
const GOTO_TIMEOUT = 15000;    // timeout de goto
const SEL_TIMEOUT  = 5000;     // timeout de waitForSelector
const PATH_JSON    = path.resolve(__dirname, 'sons.json');

const TERMOS = [
  'brasil',
  'Trending%20Brasil',
  'br',
  'viral',
  'whatsapp%20audios'
];

app.use(cors());
const delay = ms => new Promise(r => setTimeout(r, ms));

/* ---------- util ---------- */
function lerArquivo() {
  try {
    return JSON.parse(fs.readFileSync(PATH_JSON, 'utf-8'));
  } catch {
    fs.writeFileSync(PATH_JSON, '[]', 'utf-8');
    return [];
  }
}
function gravarArquivo(arr) {
  fs.writeFileSync(PATH_JSON, JSON.stringify(arr, null, 2), 'utf-8');
}
function adicionarESalvar(novos) {
  if (!novos.length) return;
  const atuais = lerArquivo();
  const atualizados = atuais.concat(novos);
  gravarArquivo(atualizados);
  console.log(`💾 +${novos.length} → total ${atualizados.length}`);
}

/* ---------- raspagem ---------- */
async function buscarPorTermo(browser, termo, existingLinks) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

  const novosDoTermo = [];
  for (let p = 1; novosDoTermo.length < SON_LIMIT; p++) {
    /* 1. navegação */
    try {
      await page.goto(
        `https://www.myinstants.com/pt/search/?name=${termo}&page=${p}`,
        { waitUntil: 'domcontentloaded', timeout: GOTO_TIMEOUT }
      );
    } catch (err) {
      console.warn(`⚠️  goto falhou (${termo} p${p}): ${err.message}`);
      break;                       // ← agora o break está legal 😊
    }

    /* 2. extrair sons da página */
    let sonsPagina = [];
    try {
      sonsPagina = await page.$$eval('.instant', els =>
        els.map(el => {
          const nome = el.textContent.trim();
          const btn  = el.querySelector('[onclick]');
          if (!btn) return null;
          const m = btn.getAttribute('onclick')
                       .match(/'(\/media\/sounds\/[^']+\.mp3)'/);
          return m ? { nome, link: 'https://www.myinstants.com' + m[1] } : null;
        }).filter(Boolean)
      );
    } catch (err) {
      console.warn(`⚠️  extração falhou (${termo} p${p}): ${err.message}`);
      break;
    }

    /* 3. filtra duplicados e aplica limite */
    const filtrados = sonsPagina.filter(s => !existingLinks.has(s.link));
    if (!filtrados.length) break;

    const qtdFaltando  = SON_LIMIT - novosDoTermo.length;
    const selecionados = filtrados.slice(0, qtdFaltando);

    selecionados.forEach(s => {
      existingLinks.add(s.link);
      novosDoTermo.push(s);
    });

    adicionarESalvar(selecionados);   // grava imediatamente
    await delay(PAGE_DELAY);
  }

  await page.close();
  console.log(`✅  ${termo}: ${novosDoTermo.length} sons novos`);
}

/* ---------- job principal ---------- */
async function fetchSons() {
  const existentes     = lerArquivo();
  const existingLinks  = new Set(existentes.map(s => s.link));

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const termo of TERMOS) {
    await buscarPorTermo(browser, termo, existingLinks);
  }

  await browser.close();
  console.log('🏁  raspagem concluída.');
}

/* ---------- agendamentos ---------- */
fetchSons().catch(err => console.error('🔴 fetchSons() fatal:', err));

schedule.scheduleJob('0 0 * * 0', () =>
  fetchSons().catch(err => console.error('🔴 fetchSons() agendado fatal:', err))
);

/* ---------- endpoints ---------- */
app.get('/sons', (_, res) => res.json(lerArquivo()));

app.listen(PORT, () =>
  console.log(`🚀  API pronta em http://localhost:${PORT}`)
);


//cd servidor-som node index.js

const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const FIREBASE_ROOT_PATH = "controle-gastos-cartoes";
const NOVO_ITEM_VALUE = "__novo__";
const LISTAS_VERSAO_ATUAL = "sem-padroes-2026-04-01";

const cartoesPadrao = [];
const categoriasPadrao = [];
const cartoesBloqueados = ["Nubank"];
const categoriasBloqueadas = ["Laazer", "Outros"];

let dados = {};
let cartoes = obterListaUnica(cartoesPadrao, "cartao");
let categorias = obterListaUnica(categoriasPadrao, "categoria");
let anoAtual = definirAnoInicial();
let mesAtual = new Date().getMonth();
let editandoIndex = null;
let estadoPronto = false;

const filtros = {
    descricao: "",
    cartao: "",
    categoria: "",
    valor: ""
};

const coresCategorias = [
    "#4f46e5",
    "#0ea5e9",
    "#14b8a6",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#84cc16"
];

const coresCartoes = [
    "#4f46e5",
    "#ef4444",
    "#14b8a6",
    "#f59e0b",
    "#8b5cf6",
    "#06b6d4",
    "#22c55e",
    "#ec4899",
    "#f97316",
    "#64748b"
];

function normalizarTexto(valor){
    return String(valor || "").toLowerCase().trim();
}

function normalizarChaveLista(valor){
    return normalizarTexto(valor)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

function normalizarItemLista(tipo, valor){
    const texto = String(valor || "").trim();
    if(!texto) return "";

    const chave = normalizarChaveLista(texto);

    if(tipo === "cartao"){
        const mapaCartoes = {
            "c6": "C6 Bank",
            "c6 bank": "C6 Bank",
            "carrefour": "Carrefour",
            "itau": "Itaú",
            "porto": "Porto"
        };

        return mapaCartoes[chave] || texto;
    }

    const mapaCategorias = {
        "alimentacao": "Alimentação",
        "combustivel": "Combustível",
        "lazer": "Lazer"
    };

    return mapaCategorias[chave] || texto;
}

function itemBloqueado(tipo, valor){
    const listaBloqueada = tipo === "cartao" ? cartoesBloqueados : categoriasBloqueadas;
    return listaBloqueada.some((item) => normalizarChaveLista(item) === normalizarChaveLista(valor));
}

function definirAnoInicial(){
    const anoDoSistema = new Date().getFullYear();
    if(anoDoSistema < 2026) return "2026";
    if(anoDoSistema > 2099) return "2099";
    return String(anoDoSistema);
}

function normalizarMes(valor){
    const mes = Number.parseInt(valor, 10);
    if(Number.isInteger(mes) && mes >= 0 && mes <= 11) return mes;
    return new Date().getMonth();
}

function montarEstadoParaPersistencia(){
    return {
        dados,
        cartoes,
        categorias,
        preferencias: {
            mesAtual,
            anoAtual
        },
        listasVersao: LISTAS_VERSAO_ATUAL
    };
}

function aplicarEstadoRemoto(estado){
    const listasResetadas = estado?.listasVersao !== LISTAS_VERSAO_ATUAL;
    const cartoesRemotos = Array.isArray(estado?.cartoes) && !listasResetadas ? estado.cartoes : [];
    const categoriasRemotas = Array.isArray(estado?.categorias) && !listasResetadas ? estado.categorias : [];

    dados = estado?.dados && typeof estado.dados === "object" ? estado.dados : {};
    cartoes = obterListaUnica([...cartoesPadrao, ...cartoesRemotos], "cartao");
    categorias = obterListaUnica([...categoriasPadrao, ...categoriasRemotas], "categoria");
    anoAtual = String(estado?.preferencias?.anoAtual || definirAnoInicial());
    mesAtual = normalizarMes(estado?.preferencias?.mesAtual);
}

async function salvarEstado(){
    await db.ref(FIREBASE_ROOT_PATH).set(montarEstadoParaPersistencia());
}

async function carregarEstadoInicial(){
    const snapshot = await db.ref(FIREBASE_ROOT_PATH).once("value");
    const estado = snapshot.val();

    aplicarEstadoRemoto(estado);

    if(!estado || estado.listasVersao !== LISTAS_VERSAO_ATUAL){
        await salvarEstado();
    }
}

function escapeHtml(valor){
    return String(valor)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function obterListaUnica(lista, tipo){
    const mapa = new Map();

    lista.forEach((item) => {
        const valorNormalizado = normalizarItemLista(tipo, item);
        if(!valorNormalizado) return;
        if(itemBloqueado(tipo, valorNormalizado)) return;

        const chave = normalizarChaveLista(valorNormalizado);
        if(!mapa.has(chave)) mapa.set(chave, valorNormalizado);
    });

    return [...mapa.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function sincronizarListasComDados(){
    cartoes = obterListaUnica([...cartoesPadrao, ...cartoes], "cartao");
    categorias = obterListaUnica([...categoriasPadrao, ...categorias], "categoria");
}

function montarOpcoes(lista, placeholder, incluirNovo = false){
    const placeholderHtml = `<option value="" selected disabled>${escapeHtml(placeholder)}</option>`;
    const opcoesHtml = lista.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    const opcaoNovoHtml = incluirNovo ? `<option value="${NOVO_ITEM_VALUE}">+ Cadastrar novo</option>` : "";
    return `${placeholderHtml}${opcoesHtml}${opcaoNovoHtml}`;
}

function montarOpcoesFiltro(lista, placeholder){
    const placeholderHtml = `<option value="">${escapeHtml(placeholder)}</option>`;
    const opcoesHtml = lista.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    return `${placeholderHtml}${opcoesHtml}`;
}

function montarOpcoesEdicao(lista, valorSelecionado){
    return lista.map((item) => `<option ${normalizarChaveLista(item) === normalizarChaveLista(valorSelecionado) ? "selected" : ""}>${escapeHtml(item)}</option>`).join("");
}

function preencherSelectsFixos(){
    const selectCartao = document.getElementById("cartao");
    const selectCategoria = document.getElementById("categoria");
    const filtroCartao = document.getElementById("filtroCartao");
    const filtroCategoria = document.getElementById("filtroCategoria");

    cartoes = obterListaUnica(cartoes, "cartao");
    categorias = obterListaUnica(categorias, "categoria");

    selectCartao.innerHTML = montarOpcoes(cartoes, "Selecione o Cartão", true);
    selectCategoria.innerHTML = montarOpcoes(categorias, "Tipo de Despesa", true);
    filtroCartao.innerHTML = montarOpcoesFiltro(cartoes, "Todos os cartões");
    filtroCategoria.innerHTML = montarOpcoesFiltro(categorias, "Todas as categorias");

    selectCartao.value = "";
    selectCategoria.value = "";
    filtroCartao.value = filtros.cartao;
    filtroCategoria.value = filtros.categoria;
}

async function cadastrarNovoItem(tipo){
    const configuracao = tipo === "cartao"
        ? {
            titulo: "cartão",
            lista: cartoes,
            selectId: "cartao"
        }
        : {
            titulo: "categoria",
            lista: categorias,
            selectId: "categoria"
        };

    const novoNome = window.prompt(`Digite o nome do novo ${configuracao.titulo}:`);
    if(novoNome === null) {
        document.getElementById(configuracao.selectId).value = "";
        return;
    }

    const nomeTratado = novoNome.trim();
    if(!nomeTratado) {
        document.getElementById(configuracao.selectId).value = "";
        return;
    }

    const nomeNormalizado = normalizarItemLista(tipo, nomeTratado);
    const existe = configuracao.lista.some((item) => normalizarChaveLista(item) === normalizarChaveLista(nomeNormalizado));
    const nomeFinal = existe
        ? configuracao.lista.find((item) => normalizarChaveLista(item) === normalizarChaveLista(nomeNormalizado))
        : nomeNormalizado;

    if(!existe) {
        configuracao.lista.push(nomeFinal);
        if(tipo === "cartao") {
            cartoes = obterListaUnica(configuracao.lista, "cartao");
        } else {
            categorias = obterListaUnica(configuracao.lista, "categoria");
        }
        await salvarEstado();
    }

    preencherSelectsFixos();
    document.getElementById(configuracao.selectId).value = nomeFinal;
}

function inicializarSelectsDinamicos(){
    preencherSelectsFixos();

    document.getElementById("cartao").addEventListener("change", (event) => {
        if(event.target.value === NOVO_ITEM_VALUE) cadastrarNovoItem("cartao");
    });

    document.getElementById("categoria").addEventListener("change", (event) => {
        if(event.target.value === NOVO_ITEM_VALUE) cadastrarNovoItem("categoria");
    });
}

function carregarAnos(){
    const selectAno = document.getElementById("ano");
    selectAno.innerHTML = "";

    for(let ano = 2026; ano <= 2099; ano++){
        selectAno.innerHTML += `<option value="${ano}">${ano}</option>`;
    }

    selectAno.value = anoAtual;
    selectAno.addEventListener("change", (event) => {
        anoAtual = event.target.value;
        salvarEstado().catch((error) => {
            console.error("Erro ao salvar o ano atual no Firebase:", error);
        });
        editandoIndex = null;
        atualizarTela();
    });
}

function criarAbas(){
    const abasMeses = document.getElementById("abasMeses");
    abasMeses.innerHTML = "";

    meses.forEach((mes, index) => {
        const aba = document.createElement("button");
        aba.type = "button";
        aba.className = index === mesAtual ? "tab active" : "tab";
        aba.textContent = mes;
        aba.onclick = () => {
            mesAtual = index;
            salvarEstado().catch((error) => {
                console.error("Erro ao salvar o mes atual no Firebase:", error);
            });
            editandoIndex = null;
            atualizarTela();
        };
        abasMeses.appendChild(aba);
    });
}

function inicializarFiltros(){
    document.getElementById("filtroDescricao").addEventListener("input", (event) => {
        filtros.descricao = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.getElementById("filtroCartao").addEventListener("change", (event) => {
        filtros.cartao = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.getElementById("filtroCategoria").addEventListener("change", (event) => {
        filtros.categoria = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.getElementById("filtroValor").addEventListener("input", (event) => {
        filtros.valor = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.addEventListener("click", (event) => {
        if(event.target.closest(".filter-popover") || event.target.closest(".filter-toggle")) return;
        fecharFiltros();
    });
}

function toggleFiltro(nome){
    const popoverAtual = document.getElementById(`popover${nome}`);
    const vaiAbrir = !popoverAtual.classList.contains("is-open");

    fecharFiltros();

    if(vaiAbrir){
        popoverAtual.classList.add("is-open");
        const campo = popoverAtual.querySelector("input, select");
        if(campo) campo.focus();
    }
}

function fecharFiltros(){
    document.querySelectorAll(".filter-popover").forEach((popover) => {
        popover.classList.remove("is-open");
    });
}

function getLancamentosMes(){
    if(!dados[anoAtual] || !dados[anoAtual][mesAtual]) return [];
    return dados[anoAtual][mesAtual];
}

function getLancamentosFiltrados(){
    const filtroDescricao = normalizarTexto(filtros.descricao);
    const filtroCartao = normalizarTexto(filtros.cartao);
    const filtroCategoria = normalizarTexto(filtros.categoria);
    const filtroValor = String(filtros.valor || "").replace(",", ".").trim();

    return getLancamentosMes()
        .map((gasto, index) => ({ ...gasto, originalIndex: index }))
        .filter((gasto) => {
            const descricaoOk = !filtroDescricao || normalizarTexto(gasto.descricao).includes(filtroDescricao);
            const cartaoOk = !filtroCartao || normalizarChaveLista(gasto.cartao) === normalizarChaveLista(filtroCartao);
            const categoriaOk = !filtroCategoria || normalizarChaveLista(gasto.categoria) === normalizarChaveLista(filtroCategoria);
            const valorTexto = gasto.valor.toFixed(2);
            const valorOk = !filtroValor || valorTexto.includes(filtroValor) || String(gasto.valor).includes(filtroValor);

            return descricaoOk && cartaoOk && categoriaOk && valorOk;
        });
}

function formatarMoeda(valor){
    return valor.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL"
    });
}

function gerarDadosGrafico(lancamentos){
    const totaisPorCategoria = new Map();

    lancamentos.forEach((gasto) => {
        const categoria = gasto.categoria || "Sem categoria";
        totaisPorCategoria.set(categoria, (totaisPorCategoria.get(categoria) || 0) + gasto.valor);
    });

    return [...totaisPorCategoria.entries()]
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total);
}

function gerarMapaCoresCategorias(categoriasLista){
    const mapa = new Map();

    categoriasLista.forEach((categoria, index) => {
        mapa.set(categoria, coresCategorias[index % coresCategorias.length]);
    });

    return mapa;
}

function gerarMapaCoresCartoes(cartoesLista){
    const mapa = new Map();

    cartoesLista.forEach((cartao, index) => {
        mapa.set(cartao, coresCartoes[index % coresCartoes.length]);
    });

    return mapa;
}

function getLancamentosAnoAtual(){
    if(!dados[anoAtual]) return [];

    return Object.values(dados[anoAtual]).flat();
}

function gerarDadosPizzaAnual(){
    const lancamentosAno = getLancamentosAnoAtual();
    const categoriasAno = obterListaUnica(lancamentosAno.map((gasto) => gasto.categoria).filter(Boolean), "categoria");
    const mapaCores = gerarMapaCoresCategorias(categoriasAno);

    return cartoes.map((cartao) => {
        const lancamentosCartao = lancamentosAno.filter((gasto) => normalizarChaveLista(gasto.cartao) === normalizarChaveLista(cartao));
        const totaisPorCategoria = new Map();

        lancamentosCartao.forEach((gasto) => {
            const categoria = gasto.categoria || "Sem categoria";
            totaisPorCategoria.set(categoria, (totaisPorCategoria.get(categoria) || 0) + gasto.valor);
        });

        const categorias = [...totaisPorCategoria.entries()]
            .map(([categoria, total]) => ({
                categoria,
                total,
                cor: mapaCores.get(categoria) || coresCategorias[0]
            }))
            .sort((a, b) => b.total - a.total);

        const totalCartao = categorias.reduce((acumulado, item) => acumulado + item.total, 0);

        return {
            cartao,
            total: totalCartao,
            categorias
        };
    });
}

function gerarDadosPizzaGeralCartoes(){
    const lancamentosAno = getLancamentosAnoAtual();
    const cartoesAno = obterListaUnica(lancamentosAno.map((gasto) => gasto.cartao).filter(Boolean), "cartao");
    const cartoesLegenda = obterListaUnica([...cartoes, ...cartoesAno], "cartao");
    const mapaCores = gerarMapaCoresCartoes(cartoesLegenda);
    const totaisPorCartao = new Map();

    lancamentosAno.forEach((gasto) => {
        const cartao = gasto.cartao || "Sem cartão";
        totaisPorCartao.set(cartao, (totaisPorCartao.get(cartao) || 0) + gasto.valor);
    });

    const itens = [...totaisPorCartao.entries()]
        .map(([cartao, total]) => ({
            categoria: cartao,
            total,
            cor: mapaCores.get(cartao) || coresCartoes[0]
        }))
        .sort((a, b) => b.total - a.total);

    return {
        cartao: "Total geral de cartões",
        total: itens.reduce((acumulado, item) => acumulado + item.total, 0),
        categorias: itens
    };
}

function renderizarGraficoCategorias(){
    const grafico = document.getElementById("graficoCategorias");
    const dadosGrafico = gerarDadosGrafico(getLancamentosFiltrados());

    if(!dadosGrafico.length){
        grafico.innerHTML = `<div class="chart-empty">Nenhum lançamento disponível para gerar o gráfico do mês selecionado.</div>`;
        return;
    }

    const maiorValor = Math.max(...dadosGrafico.map((item) => item.total), 0);

    const barras = dadosGrafico.map((item) => {
        const altura = maiorValor > 0 ? (item.total / maiorValor) * 100 : 0;

        return `
            <div class="chart-bar-group">
                <div class="chart-bar-wrap">
                    <div class="chart-bar" style="height: ${altura}%;">
                        <span class="chart-bar-value">${formatarMoeda(item.total)}</span>
                    </div>
                </div>
                <div class="chart-bar-label">${escapeHtml(item.categoria)}</div>
            </div>
        `;
    }).join("");

    grafico.innerHTML = `
        <div class="bar-chart">
            <div class="chart-plot">
                <div class="chart-grid">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
                <div class="chart-bars">${barras}</div>
            </div>
        </div>
    `;
}

function montarGradientePizza(categoriasLista){
    if(!categoriasLista.length) return "";

    const total = categoriasLista.reduce((acumulado, item) => acumulado + item.total, 0);
    let acumulado = 0;

    const partes = categoriasLista.map((item) => {
        const inicio = acumulado;
        const percentual = total > 0 ? (item.total / total) * 100 : 0;
        acumulado += percentual;
        return `${item.cor} ${inicio}% ${acumulado}%`;
    });

    return `conic-gradient(${partes.join(", ")})`;
}

function formatarPercentual(valor){
    return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function montarLabelsPercentuaisPizza(categoriasLista, total, tamanho = 168){
    if(!categoriasLista.length || total <= 0) return "";

    const centro = tamanho / 2;
    const raio = tamanho * 0.43;
    let acumulado = 0;

    return categoriasLista.map((item) => {
        const percentual = (item.total / total) * 100;
        const inicio = acumulado;
        acumulado += percentual;
        const angulo = ((inicio + percentual / 2) / 100) * (Math.PI * 2) - Math.PI / 2;
        const x = centro + Math.cos(angulo) * raio;
        const y = centro + Math.sin(angulo) * raio;

        return `<span class="pie-chart-percent" style="left:${x}px; top:${y}px;">${formatarPercentual(percentual)}</span>`;
    }).join("");
}

function montarCardPizza(cartaoInfo, extraClass = "", mostrarPercentualNoGrafico = false){
    if(!cartaoInfo.categorias.length){
        return `
            <article class="pie-card ${extraClass}">
                <div class="pie-card-header">
                    <div class="pie-card-title">${escapeHtml(cartaoInfo.cartao)}</div>
                    <div class="pie-card-total">${formatarMoeda(0)}</div>
                </div>
                <div class="pie-chart-wrap">
                    <div class="pie-chart-empty">Sem gastos no ano selecionado</div>
                </div>
            </article>
        `;
    }

    const legenda = cartaoInfo.categorias.map((item) => {
        return `
            <div class="pie-legend-item">
                <span class="pie-legend-color" style="background: ${item.cor};"></span>
                <span class="pie-legend-label">${escapeHtml(item.categoria)}</span>
                <span class="pie-legend-value">${formatarMoeda(item.total)}</span>
            </div>
        `;
    }).join("");

    const tamanhoGrafico = extraClass.includes("summary-card") ? 220 : 168;
    const labelsPercentuais = mostrarPercentualNoGrafico
        ? `<div class="pie-chart-labels">${montarLabelsPercentuaisPizza(cartaoInfo.categorias, cartaoInfo.total, tamanhoGrafico)}</div>`
        : "";

    return `
        <article class="pie-card ${extraClass}">
            <div class="pie-card-header">
                <div class="pie-card-title">${escapeHtml(cartaoInfo.cartao)}</div>
                <div class="pie-card-total">${formatarMoeda(cartaoInfo.total)}</div>
            </div>
            <div class="pie-chart-wrap">
                <div class="pie-chart" style="background: ${montarGradientePizza(cartaoInfo.categorias)};">
                    ${labelsPercentuais}
                </div>
            </div>
            <div class="pie-legend">${legenda}</div>
        </article>
    `;
}

function renderizarGraficosPizzaAnuais(){
    const container = document.getElementById("graficosCartoesAno");
    const containerResumo = document.getElementById("graficoGeralCartoes");
    const dadosPizza = gerarDadosPizzaAnual();
    const graficoGeral = gerarDadosPizzaGeralCartoes();

    container.innerHTML = dadosPizza.map((cartaoInfo) => montarCardPizza(cartaoInfo)).join("");
    containerResumo.innerHTML = montarCardPizza(graficoGeral, "summary-card", true);
}

async function adicionarGasto(){
    const descricao = document.getElementById("descricao").value.trim();
    const cartao = document.getElementById("cartao").value;
    const categoria = document.getElementById("categoria").value;
    const valor = parseFloat(document.getElementById("valor").value);
    const parcelas = parseInt(document.getElementById("parcelas").value) || 1;

    if(!descricao || !cartao || !categoria || !valor || !parcelas) return;

    const valorParcela = valor / parcelas;

    for(let i = 0; i < parcelas; i++){
        let mesParcela = mesAtual + i;
        let anoParcela = parseInt(anoAtual);

        while(mesParcela > 11){
            mesParcela -= 12;
            anoParcela++;
        }

        if(!dados[anoParcela]) dados[anoParcela] = {};
        if(!dados[anoParcela][mesParcela]) dados[anoParcela][mesParcela] = [];

        dados[anoParcela][mesParcela].push({
            descricao: descricao + " (" + (i + 1) + "/" + parcelas + ")",
            cartao,
            categoria,
            valor: valorParcela
        });
    }

    await salvarEstado();
    limparFormulario();
    atualizarTela();
}

function limparFormulario(){
    document.getElementById("descricao").value = "";
    document.getElementById("cartao").value = "";
    document.getElementById("categoria").value = "";
    document.getElementById("valor").value = "";
    document.getElementById("parcelas").value = "";
}

function renderLinhaEdicao(gasto){
    return `
        <tr class="edit-row">
            <td><input type="text" id="editDescricao" value="${escapeHtml(gasto.descricao)}"></td>
            <td>
                <select id="editCartao">
                    ${montarOpcoesEdicao(cartoes, gasto.cartao)}
                </select>
            </td>
            <td>
                <select id="editCategoria">
                    ${montarOpcoesEdicao(categorias, gasto.categoria)}
                </select>
            </td>
            <td><input type="number" id="editValor" min="0" step="0.01" value="${gasto.valor.toFixed(2)}"></td>
            <td class="actions-cell">
                <div class="action-buttons">
                    <button class="inline-action save-button" onclick="salvarEdicao(${gasto.originalIndex})">Salvar</button>
                    <button class="inline-action cancel-button" onclick="cancelarEdicao()">Cancelar</button>
                </div>
            </td>
        </tr>
    `;
}

function renderLinhaVisual(gasto){
    return `
        <tr>
            <td>${escapeHtml(gasto.descricao)}</td>
            <td>${escapeHtml(gasto.cartao)}</td>
            <td>${escapeHtml(gasto.categoria)}</td>
            <td>${formatarMoeda(gasto.valor)}</td>
            <td class="actions-cell">
                <div class="action-buttons">
                    <button class="icon-button edit-button" onclick="iniciarEdicao(${gasto.originalIndex})" title="Editar lançamento" aria-label="Editar lançamento">&#9998;</button>
                    <button class="icon-button delete-button" onclick="remover(${gasto.originalIndex})" title="Remover lançamento" aria-label="Remover lançamento">X</button>
                </div>
            </td>
        </tr>
    `;
}

function atualizarTela(){
    criarAbas();
    preencherSelectsFixos();

    const lista = document.getElementById("lista");
    lista.innerHTML = "";

    const lancamentosMes = getLancamentosMes();
    const lancamentosFiltrados = getLancamentosFiltrados();
    const total = lancamentosMes.reduce((acumulado, gasto) => acumulado + gasto.valor, 0);

    if(lancamentosFiltrados.length === 0){
        lista.innerHTML = `
            <tr class="empty-state">
                <td colspan="5">Nenhum lançamento encontrado para os filtros informados.</td>
            </tr>
        `;
    } else {
        lancamentosFiltrados.forEach((gasto) => {
            lista.innerHTML += gasto.originalIndex === editandoIndex
                ? renderLinhaEdicao(gasto)
                : renderLinhaVisual(gasto);
        });
    }

    document.getElementById("total").innerText = formatarMoeda(total);
    renderizarGraficoCategorias();
    renderizarGraficosPizzaAnuais();
}

function iniciarEdicao(index){
    editandoIndex = index;
    atualizarTela();
}

function cancelarEdicao(){
    editandoIndex = null;
    atualizarTela();
}

async function salvarEdicao(index){
    const descricao = document.getElementById("editDescricao").value.trim();
    const cartao = document.getElementById("editCartao").value;
    const categoria = document.getElementById("editCategoria").value;
    const valor = parseFloat(document.getElementById("editValor").value);

    if(!descricao || !cartao || !categoria || !valor) return;

    dados[anoAtual][mesAtual][index] = {
        descricao,
        cartao,
        categoria,
        valor
    };

    await salvarEstado();
    editandoIndex = null;
    atualizarTela();
}

async function remover(index){
    if(!dados[anoAtual] || !dados[anoAtual][mesAtual]) return;

    dados[anoAtual][mesAtual].splice(index, 1);

    if(dados[anoAtual][mesAtual].length === 0){
        delete dados[anoAtual][mesAtual];
    }

    editandoIndex = null;
    await salvarEstado();
    atualizarTela();
}

async function inicializarApp(){
    try {
        await carregarEstadoInicial();
        sincronizarListasComDados();
        carregarAnos();
        inicializarSelectsDinamicos();
        inicializarFiltros();
        atualizarTela();
        estadoPronto = true;
    } catch (error) {
        console.error("Erro ao carregar dados do Firebase:", error);
        window.alert("Nao foi possivel carregar os dados do Firebase. Verifique a configuracao e tente novamente.");
    }
}

db.ref(FIREBASE_ROOT_PATH).on("value", (snapshot) => {
    if(!estadoPronto) return;

    aplicarEstadoRemoto(snapshot.val());
    atualizarTela();
});

inicializarApp();

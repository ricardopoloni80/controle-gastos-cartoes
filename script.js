const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const FIREBASE_ROOT_PATH = "controle-gastos-cartoes";
const NOVO_ITEM_VALUE = "__novo__";
const LISTAS_VERSAO_ATUAL = "sem-padroes-2026-04-01";
const AUTH_REDIRECT_KEY = "controle-gastos-cartoes:auth-redirect";

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
let usuarioLogado = null;
let appInicializado = false;
let unsubscribeDados = null;
let autenticacaoManualPendente = false;

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

function gerarIdSerie(){
    return `serie-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function obterListaUnica(lista, tipo){
    const mapa = new Map();

    (lista || []).forEach((item) => {
        const valorNormalizado = normalizarItemLista(tipo, item);
        if(!valorNormalizado) return;
        if(itemBloqueado(tipo, valorNormalizado)) return;

        const chave = normalizarChaveLista(valorNormalizado);
        if(!mapa.has(chave)) mapa.set(chave, valorNormalizado);
    });

    return [...mapa.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function getCaminhoDadosUsuario(uid = usuarioLogado?.uid){
    if(!uid) throw new Error("Usuário não autenticado.");
    return `${FIREBASE_ROOT_PATH}/${uid}`;
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
    if(!usuarioLogado) throw new Error("Usuário não autenticado.");
    await db.ref(getCaminhoDadosUsuario()).set(montarEstadoParaPersistencia());
}

async function carregarEstadoInicial(){
    if(!usuarioLogado) throw new Error("Usuário não autenticado.");

    const caminhoUsuario = getCaminhoDadosUsuario();
    const snapshotUsuario = await db.ref(caminhoUsuario).once("value");
    const estado = snapshotUsuario.val();

    aplicarEstadoRemoto(estado);

    if(estado && estado.listasVersao !== LISTAS_VERSAO_ATUAL){
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

function obterNomeUsuario(){
    const nome = usuarioLogado?.displayName || usuarioLogado?.email || "";
    return String(nome).trim();
}

function marcarRedirectEmAndamento(){
    try {
        sessionStorage.setItem(AUTH_REDIRECT_KEY, "1");
    } catch (error) {
        console.warn("Não foi possível registrar o redirect de autenticação:", error);
    }
}

function limparRedirectEmAndamento(){
    try {
        sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    } catch (error) {
        console.warn("Não foi possível limpar o estado do redirect de autenticação:", error);
    }
}

function redirectEmAndamento(){
    try {
        return sessionStorage.getItem(AUTH_REDIRECT_KEY) === "1";
    } catch (error) {
        console.warn("Não foi possível consultar o estado do redirect de autenticação:", error);
        return false;
    }
}

function atualizarVisibilidadeTelas(){
    const authShell = document.getElementById("authShell");
    const appShell = document.getElementById("appShell");
    const usuarioAutenticado = Boolean(usuarioLogado);

    if(authShell) authShell.classList.toggle("is-hidden", usuarioAutenticado);
    if(appShell) appShell.classList.toggle("is-hidden", !usuarioAutenticado);
}

function fecharMenuUsuario(){
    const menu = document.getElementById("menuUsuario");
    const botao = document.getElementById("botaoUsuario");
    if(menu) menu.classList.remove("is-open");
    if(botao) botao.setAttribute("aria-expanded", "false");
}

function toggleMenuUsuario(){
    const menu = document.getElementById("menuUsuario");
    const botao = document.getElementById("botaoUsuario");
    if(!menu || !botao) return;

    const vaiAbrir = !menu.classList.contains("is-open");
    fecharMenuUsuario();

    if(vaiAbrir){
        menu.classList.add("is-open");
        botao.setAttribute("aria-expanded", "true");
    }
}

async function sairDoSistema(){
    autenticacaoManualPendente = true;
    fecharMenuUsuario();

    try {
        await firebase.auth().signOut();
    } catch (error) {
        autenticacaoManualPendente = false;
        console.error("Erro ao sair do sistema:", error);
        window.alert("Não foi possível sair do sistema. Tente novamente.");
    }
}

function atualizarSaudacaoUsuario(){
    const container = document.getElementById("saudacaoUsuario");
    if(!container) return;

    if(usuarioLogado){
        const nomeUsuario = escapeHtml(obterNomeUsuario() || "usuário");
        container.innerHTML = `
            <button
                type="button"
                class="user-name-trigger"
                id="botaoUsuario"
                aria-haspopup="true"
                aria-expanded="false"
                aria-controls="menuUsuario"
            >
                <span class="user-greeting-text">Olá, ${nomeUsuario}</span>
                <svg class="logout-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path fill="currentColor" d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3zm5.59 4.59L14.17 9l2.59 2.5H8v2h8.76l-2.59 2.5 1.42 1.41L21 12l-5.41-5.41z"></path>
                    <path fill="currentColor" d="M19 5h-6v2h6v10h-6v2h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" opacity=".35"></path>
                </svg>
            </button>
            <div class="user-menu" id="menuUsuario" role="menu">
                <span class="user-menu-label">Conta</span>
                <button type="button" class="user-menu-action" id="botaoSair" role="menuitem">Sair do sistema</button>
            </div>
        `;

        document.getElementById("botaoUsuario")?.addEventListener("click", (event) => {
            event.stopPropagation();
            toggleMenuUsuario();
        });

        document.getElementById("menuUsuario")?.addEventListener("click", (event) => {
            event.stopPropagation();
        });

        document.getElementById("botaoSair")?.addEventListener("click", () => {
            sairDoSistema().catch((error) => {
                console.error("Erro ao finalizar logout:", error);
            });
        });

        return;
    }

    container.innerHTML = "";
}

function inicializarAutenticacaoUI(){
    document.getElementById("botaoEntrarGoogleInicial")?.addEventListener("click", () => {
        autenticacaoManualPendente = false;
        autenticarComGoogle().catch((error) => {
            console.error("Erro ao iniciar login manual:", error);
        });
    });
}

function sincronizarListasComDados(){
    cartoes = obterListaUnica([...cartoesPadrao, ...cartoes], "cartao");
    categorias = obterListaUnica([...categoriasPadrao, ...categorias], "categoria");
}

function montarOpcoes(lista, placeholder, incluirNovo = false){
    const placeholderHtml = `<option value="" selected hidden>${escapeHtml(placeholder)}</option>`;
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
        if(event.target.value === NOVO_ITEM_VALUE) {
            cadastrarNovoItem("cartao").catch((error) => {
                console.error("Erro ao cadastrar cartão:", error);
            });
        }
    });

    document.getElementById("categoria").addEventListener("change", (event) => {
        if(event.target.value === NOVO_ITEM_VALUE) {
            cadastrarNovoItem("categoria").catch((error) => {
                console.error("Erro ao cadastrar categoria:", error);
            });
        }
    });
}

function carregarAnos(){
    const selectAno = document.getElementById("ano");
    const opcoes = [];

    for(let ano = 2026; ano <= 2099; ano++){
        opcoes.push(`<option value="${ano}">${ano}</option>`);
    }

    selectAno.innerHTML = opcoes.join("");

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
                console.error("Erro ao salvar o mês atual no Firebase:", error);
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
        fecharFiltros();
        atualizarTela();
    });

    document.getElementById("filtroCategoria").addEventListener("change", (event) => {
        filtros.categoria = event.target.value;
        editandoIndex = null;
        fecharFiltros();
        atualizarTela();
    });

    document.getElementById("filtroValor").addEventListener("input", (event) => {
        filtros.valor = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.getElementById("filtroDescricao").addEventListener("keydown", (event) => {
        if(event.key === "Enter") fecharFiltros();
    });

    document.getElementById("filtroValor").addEventListener("keydown", (event) => {
        if(event.key === "Enter") fecharFiltros();
    });

    document.addEventListener("click", (event) => {
        if(event.target.closest(".filter-popover") || event.target.closest(".filter-toggle")) return;
        fecharFiltros();
    });

    document.addEventListener("click", (event) => {
        if(event.target.closest("#saudacaoUsuario")) return;
        fecharMenuUsuario();
    });

    document.addEventListener("keydown", (event) => {
        if(event.key === "Escape") {
            fecharFiltros();
            fecharMenuUsuario();
        }
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

function togglePainel(painelId){
    const painel = document.getElementById(painelId);
    if(!painel) return;

    const vaiFechar = !painel.classList.contains("is-collapsed");
    painel.classList.toggle("is-collapsed", vaiFechar);

    const botao = painel.querySelector(".panel-toggle");
    if(botao){
        botao.setAttribute("aria-expanded", vaiFechar ? "false" : "true");
    }
}

function getLancamentosMes(){
    if(!dados[anoAtual] || !dados[anoAtual][mesAtual]) return [];
    return dados[anoAtual][mesAtual];
}

function obterDescricaoBase(descricao){
    const texto = String(descricao || "").trim();
    const correspondencia = texto.match(/^(.*)\s+\((\d+)\/(\d+)\)$/);
    if(!correspondencia) return texto;
    return correspondencia[1].trim();
}

function obterInfoParcela(gasto){
    if(gasto?.serieIgnorada){
        return {
            base: obterDescricaoBase(gasto.descricao),
            numero: 1,
            total: 1,
            possuiSerie: false
        };
    }

    const totalSerie = Number.parseInt(gasto?.serieTotalParcelas, 10);
    const numeroSerie = Number.parseInt(gasto?.serieNumeroParcela, 10);

    if(Number.isInteger(totalSerie) && totalSerie > 1 && Number.isInteger(numeroSerie) && numeroSerie >= 1){
        return {
            base: String(gasto.serieDescricaoBase || obterDescricaoBase(gasto.descricao)),
            numero: numeroSerie,
            total: totalSerie,
            possuiSerie: true
        };
    }

    const descricao = String(gasto?.descricao || "").trim();
    const correspondencia = descricao.match(/^(.*)\s+\((\d+)\/(\d+)\)$/);
    if(!correspondencia){
        return {
            base: descricao,
            numero: 1,
            total: 1,
            possuiSerie: false
        };
    }

    const numero = Number.parseInt(correspondencia[2], 10);
    const total = Number.parseInt(correspondencia[3], 10);

    return {
        base: correspondencia[1].trim(),
        numero,
        total,
        possuiSerie: Number.isInteger(total) && total > 1
    };
}

function montarDescricaoLancamento(base, numeroParcela, totalParcelas){
    const descricaoBase = String(base || "").trim();
    if(totalParcelas > 1) return `${descricaoBase} (${numeroParcela}/${totalParcelas})`;
    return descricaoBase;
}

function limparMetadadosSerie(gasto){
    const copia = { ...gasto };
    delete copia.serieId;
    delete copia.serieTotalParcelas;
    delete copia.serieNumeroParcela;
    delete copia.serieDescricaoBase;
    copia.serieIgnorada = true;
    return copia;
}

function listarLancamentosComReferencia(){
    const referencias = [];

    Object.keys(dados || {}).forEach((ano) => {
        const mesesAno = dados[ano];
        if(!mesesAno || typeof mesesAno !== "object") return;

        Object.keys(mesesAno).forEach((mes) => {
            const lista = mesesAno[mes];
            if(!Array.isArray(lista)) return;

            lista.forEach((lancamento, index) => {
                referencias.push({
                    ano: String(ano),
                    mes: Number(mes),
                    index,
                    lancamento
                });
            });
        });
    });

    return referencias;
}

function ordenarReferenciasSerie(lista){
    return [...lista].sort((a, b) => {
        if(Number(a.ano) !== Number(b.ano)) return Number(a.ano) - Number(b.ano);
        if(a.mes !== b.mes) return a.mes - b.mes;

        const infoA = obterInfoParcela(a.lancamento);
        const infoB = obterInfoParcela(b.lancamento);
        if(infoA.numero !== infoB.numero) return infoA.numero - infoB.numero;
        return a.index - b.index;
    });
}

function obterSerieLancamento(ano, mes, index){
    const listaMes = dados?.[ano]?.[mes];
    const lancamentoAtual = Array.isArray(listaMes) ? listaMes[index] : null;
    if(!lancamentoAtual) return [];

    const infoAtual = obterInfoParcela(lancamentoAtual);
    const serieId = String(lancamentoAtual.serieId || "").trim();

    let referenciasSerie = [];

    if(serieId){
        referenciasSerie = listarLancamentosComReferencia().filter((ref) => String(ref.lancamento?.serieId || "").trim() === serieId);
    } else if(infoAtual.possuiSerie){
        const chaveComparacao = [
            normalizarChaveLista(infoAtual.base),
            normalizarChaveLista(lancamentoAtual.cartao),
            normalizarChaveLista(lancamentoAtual.categoria),
            Number(lancamentoAtual.valor || 0).toFixed(2),
            infoAtual.total
        ].join("|");

        referenciasSerie = listarLancamentosComReferencia().filter((ref) => {
            const infoRef = obterInfoParcela(ref.lancamento);
            const chaveRef = [
                normalizarChaveLista(infoRef.base),
                normalizarChaveLista(ref.lancamento?.cartao),
                normalizarChaveLista(ref.lancamento?.categoria),
                Number(ref.lancamento?.valor || 0).toFixed(2),
                infoRef.total
            ].join("|");

            return infoRef.possuiSerie && chaveRef === chaveComparacao;
        });
    } else {
        referenciasSerie = [{
            ano: String(ano),
            mes: Number(mes),
            index,
            lancamento: lancamentoAtual
        }];
    }

    return ordenarReferenciasSerie(referenciasSerie);
}

function obterModoEdicaoSerie(referenciasSerie, referenciaAtual){
    if(referenciasSerie.length <= 1) return "ocorrencia";

    const infoAtual = obterInfoParcela(referenciaAtual.lancamento);
    const possuiProximas = referenciasSerie.some((ref) => {
        const infoRef = obterInfoParcela(ref.lancamento);
        return Number(infoRef.numero) > Number(infoAtual.numero);
    });

    if(!possuiProximas) return "ocorrencia";

    const resposta = window.prompt(
        "Este lançamento faz parte de uma série.\nDigite 1 para alterar somente esta ocorrência.\nDigite 2 para alterar esta ocorrência e as demais da série.",
        "2"
    );

    if(resposta === null) return null;

    const valor = resposta.trim();
    if(valor === "1") return "ocorrencia";
    if(valor === "2") return "serie";

    window.alert("Escolha inválida. Digite 1 ou 2.");
    return null;
}

function obterModoExclusaoSerie(referenciasSerie){
    if(referenciasSerie.length <= 1) return "ocorrencia";

    const resposta = window.prompt(
        "Este lançamento faz parte de uma série.\nDigite 1 para excluir somente esta ocorrência.\nDigite 2 para excluir toda a série.",
        "1"
    );

    if(resposta === null) return null;

    const valor = resposta.trim();
    if(valor === "1") return "ocorrencia";
    if(valor === "2") return "serie";

    window.alert("Escolha inválida. Digite 1 ou 2.");
    return null;
}

function obterReferenciasParaEdicao(referenciasSerie, referenciaAtual, modo){
    if(modo !== "serie") return [referenciaAtual];

    const infoAtual = obterInfoParcela(referenciaAtual.lancamento);
    return referenciasSerie.filter((ref) => {
        const infoRef = obterInfoParcela(ref.lancamento);
        return Number(infoRef.numero) >= Number(infoAtual.numero);
    });
}

function atualizarEstadoFiltrosVisuais(){
    document.querySelectorAll(".filter-toggle").forEach((botao) => {
        const chave = botao.dataset.filterKey;
        const ativo = Boolean(String(filtros[chave] || "").trim());
        botao.classList.toggle("is-active", ativo);
        botao.setAttribute("aria-pressed", ativo ? "true" : "false");
    });
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

    const lancamentosAcumulados = [];

    for(let mes = 0; mes <= mesAtual; mes++){
        if(dados[anoAtual][mes]){
            lancamentosAcumulados.push(...dados[anoAtual][mes]);
        }
    }

    return lancamentosAcumulados;
}

function gerarDadosPizzaPorCartao(lancamentos){
    const categoriasPeriodo = obterListaUnica(lancamentos.map((gasto) => gasto.categoria).filter(Boolean), "categoria");
    const cartoesPeriodo = obterListaUnica(lancamentos.map((gasto) => gasto.cartao).filter(Boolean), "cartao");
    const cartoesLegenda = obterListaUnica([...cartoes, ...cartoesPeriodo], "cartao");
    const mapaCores = gerarMapaCoresCategorias(categoriasPeriodo);

    return cartoesLegenda.map((cartao) => {
        const lancamentosCartao = lancamentos.filter((gasto) => normalizarChaveLista(gasto.cartao) === normalizarChaveLista(cartao));
        const totaisPorCategoria = new Map();

        lancamentosCartao.forEach((gasto) => {
            const categoria = gasto.categoria || "Sem categoria";
            totaisPorCategoria.set(categoria, (totaisPorCategoria.get(categoria) || 0) + gasto.valor);
        });

        const categoriasCartao = [...totaisPorCategoria.entries()]
            .map(([categoria, total]) => ({
                categoria,
                total,
                cor: mapaCores.get(categoria) || coresCategorias[0]
            }))
            .sort((a, b) => b.total - a.total);

        const totalCartao = categoriasCartao.reduce((acumulado, item) => acumulado + item.total, 0);

        return {
            cartao,
            total: totalCartao,
            categorias: categoriasCartao
        };
    });
}

function gerarDadosPizzaAnual(){
    return gerarDadosPizzaPorCartao(getLancamentosAnoAtual());
}

function gerarDadosPizzaMensal(){
    return gerarDadosPizzaPorCartao(getLancamentosMes());
}

function gerarDadosPizzaGeralCartoes(lancamentos, titulo){
    const cartoesPeriodo = obterListaUnica(lancamentos.map((gasto) => gasto.cartao).filter(Boolean), "cartao");
    const cartoesLegenda = obterListaUnica([...cartoes, ...cartoesPeriodo], "cartao");
    const mapaCores = gerarMapaCoresCartoes(cartoesLegenda);
    const totaisPorCartao = new Map();

    lancamentos.forEach((gasto) => {
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
        cartao: titulo,
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
                    <div class="chart-bar" style="height: ${altura}%;"></div>
                </div>
                <div class="chart-bar-label-wrap">
                    <div class="chart-bar-label" title="${escapeHtml(item.categoria)}">${escapeHtml(item.categoria)}</div>
                </div>
            </div>
        `;
    }).join("");

    grafico.innerHTML = `
        <div class="bar-chart-scroll">
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
                    <div class="pie-chart-empty">Sem gastos no per&iacute;odo selecionado</div>
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
            <div class="pie-legend" title="Categorias de ${escapeHtml(cartaoInfo.cartao)}">${legenda}</div>
        </article>
    `;
}

function renderizarGraficosPizzaMensais(){
    const container = document.getElementById("graficosCartoesMes");
    const containerResumo = document.getElementById("graficoGeralCartoesMes");
    const dadosPizza = gerarDadosPizzaMensal();
    const graficoGeral = gerarDadosPizzaGeralCartoes(getLancamentosMes(), "Total mensal de cartões");

    container.innerHTML = dadosPizza.map((cartaoInfo) => montarCardPizza(cartaoInfo)).join("");
    containerResumo.innerHTML = montarCardPizza(graficoGeral, "summary-card", true);
}

function renderizarGraficosPizzaAnuais(){
    const container = document.getElementById("graficosCartoesAno");
    const containerResumo = document.getElementById("graficoGeralCartoes");
    const dadosPizza = gerarDadosPizzaAnual();
    const graficoGeral = gerarDadosPizzaGeralCartoes(getLancamentosAnoAtual(), "Total geral de cartões");

    container.innerHTML = dadosPizza.map((cartaoInfo) => montarCardPizza(cartaoInfo)).join("");
    containerResumo.innerHTML = montarCardPizza(graficoGeral, "summary-card", true);
}

async function adicionarGasto(){
    const descricao = document.getElementById("descricao").value.trim();
    const cartao = document.getElementById("cartao").value;
    const categoria = document.getElementById("categoria").value;
    const valor = parseFloat(document.getElementById("valor").value);
    const parcelas = parseInt(document.getElementById("parcelas").value, 10) || 1;

    if(!descricao || !cartao || !categoria || !valor || !parcelas) return;

    const valorParcela = valor / parcelas;
    const serieId = parcelas > 1 ? gerarIdSerie() : "";

    for(let i = 0; i < parcelas; i++){
        let mesParcela = mesAtual + i;
        let anoParcela = parseInt(anoAtual, 10);

        while(mesParcela > 11){
            mesParcela -= 12;
            anoParcela++;
        }

        if(!dados[anoParcela]) dados[anoParcela] = {};
        if(!dados[anoParcela][mesParcela]) dados[anoParcela][mesParcela] = [];

        dados[anoParcela][mesParcela].push({
            descricao: montarDescricaoLancamento(descricao, i + 1, parcelas),
            cartao,
            categoria,
            valor: valorParcela,
            serieId,
            serieNumeroParcela: i + 1,
            serieTotalParcelas: parcelas,
            serieDescricaoBase: descricao
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
    const infoParcela = obterInfoParcela(gasto);

    return `
        <tr class="edit-row">
            <td><input type="text" id="editDescricao" value="${escapeHtml(infoParcela.base)}"></td>
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
            <td>
                <button class="description-button" type="button" onclick="iniciarEdicao(${gasto.originalIndex})" title="Editar descrição">
                    ${escapeHtml(gasto.descricao)}
                </button>
            </td>
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
    atualizarSaudacaoUsuario();

    const lista = document.getElementById("lista");
    lista.innerHTML = "";

    const lancamentosFiltrados = getLancamentosFiltrados();
    const total = lancamentosFiltrados.reduce((acumulado, gasto) => acumulado + gasto.valor, 0);

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

    atualizarEstadoFiltrosVisuais();
    document.getElementById("total").innerText = formatarMoeda(total);
    renderizarGraficoCategorias();
    renderizarGraficosPizzaMensais();
    renderizarGraficosPizzaAnuais();
}

function iniciarEdicao(index){
    editandoIndex = index;
    atualizarTela();
    window.setTimeout(() => {
        const campoDescricao = document.getElementById("editDescricao");
        if(campoDescricao){
            campoDescricao.focus();
            campoDescricao.select();
        }
    }, 0);
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

    const referenciasSerie = obterSerieLancamento(anoAtual, mesAtual, index);
    const referenciaAtual = referenciasSerie.find((ref) => ref.ano === String(anoAtual) && ref.mes === Number(mesAtual) && ref.index === index);
    if(!referenciaAtual) return;

    const modo = obterModoEdicaoSerie(referenciasSerie, referenciaAtual);
    if(!modo) return;

    const referenciasAlvo = obterReferenciasParaEdicao(referenciasSerie, referenciaAtual, modo);
    const serieIdAtualizada = modo === "serie"
        ? (referenciaAtual.lancamento.serieId || gerarIdSerie())
        : "";

    referenciasAlvo.forEach((ref) => {
        const infoParcela = obterInfoParcela(ref.lancamento);
        const lancamentoAtualizado = {
            ...ref.lancamento,
            descricao: montarDescricaoLancamento(descricao, infoParcela.numero, infoParcela.total),
            cartao,
            categoria,
            valor
        };

        dados[ref.ano][ref.mes][ref.index] = modo === "ocorrencia"
            ? limparMetadadosSerie(lancamentoAtualizado)
            : {
                ...lancamentoAtualizado,
                serieId: serieIdAtualizada,
                serieNumeroParcela: infoParcela.numero,
                serieTotalParcelas: infoParcela.total,
                serieDescricaoBase: descricao,
                serieIgnorada: false
            };
    });

    await salvarEstado();
    editandoIndex = null;
    atualizarTela();
}

async function remover(index){
    if(!dados[anoAtual] || !dados[anoAtual][mesAtual]) return;

    const referenciasSerie = obterSerieLancamento(anoAtual, mesAtual, index);
    const referenciaAtual = referenciasSerie.find((ref) => ref.ano === String(anoAtual) && ref.mes === Number(mesAtual) && ref.index === index);
    if(!referenciaAtual) return;

    const modo = obterModoExclusaoSerie(referenciasSerie);
    if(!modo) return;

    const referenciasParaExcluir = modo === "serie" ? referenciasSerie : [referenciaAtual];
    const agrupadas = new Map();

    referenciasParaExcluir.forEach((ref) => {
        const chave = `${ref.ano}-${ref.mes}`;
        if(!agrupadas.has(chave)) agrupadas.set(chave, []);
        agrupadas.get(chave).push(ref.index);
    });

    agrupadas.forEach((indices, chave) => {
        const [ano, mes] = chave.split("-");
        indices.sort((a, b) => b - a).forEach((indice) => {
            dados[ano][mes].splice(indice, 1);
        });

        if(dados[ano][mes].length === 0){
            delete dados[ano][mes];
        }
    });

    editandoIndex = null;
    await salvarEstado();
    atualizarTela();
}

async function inicializarApp(){
    try {
        garantirUIInicializada();
        await carregarEstadoInicial();
        sincronizarListasComDados();
        atualizarTela();
        estadoPronto = true;
    } catch (error) {
        console.error("Erro ao carregar dados do Firebase:", error);
        garantirUIInicializada();
        sincronizarListasComDados();
        atualizarTela();
        estadoPronto = true;
        window.alert("Não foi possível carregar os dados do Firebase. Verifique autenticação, regras do banco e tente novamente.");
    }
}

function garantirUIInicializada(){
    if(appInicializado) return;

    inicializarAutenticacaoUI();
    carregarAnos();
    inicializarSelectsDinamicos();
    inicializarFiltros();
    atualizarVisibilidadeTelas();
    atualizarTela();
    appInicializado = true;
}

function assinarDadosUsuario(){
    if(!usuarioLogado) return;

    if(typeof unsubscribeDados === "function"){
        unsubscribeDados();
    }

    const refDados = db.ref(getCaminhoDadosUsuario());
    const listener = (snapshot) => {
        if(!estadoPronto) return;

        aplicarEstadoRemoto(snapshot.val());
        atualizarTela();
    };

    refDados.on("value", listener);
    unsubscribeDados = () => refDados.off("value", listener);
}

async function autenticarComGoogle(){
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    try {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch (error) {
        console.warn("Não foi possível definir a persistência local da autenticação:", error);
    }

    try {
        await firebase.auth().signInWithPopup(provider);
    } catch (error) {
        const deveUsarRedirect = [
            "auth/popup-blocked",
            "auth/popup-closed-by-user",
            "auth/cancelled-popup-request",
            "auth/operation-not-supported-in-this-environment"
        ].includes(error?.code);

        if(deveUsarRedirect){
            try {
                marcarRedirectEmAndamento();
                await firebase.auth().signInWithRedirect(provider);
                return;
            } catch (redirectError) {
                limparRedirectEmAndamento();
                console.error("Erro ao iniciar redirect de autenticação:", redirectError);
                window.alert("Não foi possível entrar com Google. Verifique se o provedor Google está habilitado no Firebase Auth.");
                return;
            }
        }

        console.error("Erro ao autenticar com Google:", error);
        window.alert("Não foi possível entrar com Google. Verifique se o provedor Google está habilitado no Firebase Auth.");
    }
}

async function concluirRedirectAutenticacao(){
    try {
        const resultado = await firebase.auth().getRedirectResult();
        if(resultado?.user) return resultado.user;
        return firebase.auth().currentUser;
    } catch (error) {
        limparRedirectEmAndamento();
        console.error("Erro ao concluir o redirect de autenticação:", error);
        window.alert("Não foi possível concluir a autenticação com Google. Tente novamente.");
        return null;
    }
}

async function processarUsuarioAutenticado(user){
    if(!user) return;

    if(usuarioLogado?.uid === user.uid && estadoPronto) {
        atualizarVisibilidadeTelas();
        return;
    }

    autenticacaoManualPendente = false;
    limparRedirectEmAndamento();
    usuarioLogado = user;
    atualizarVisibilidadeTelas();
    await inicializarApp();
    assinarDadosUsuario();
}

function processarUsuarioDeslogado(){
    usuarioLogado = null;
    estadoPronto = false;

    if(typeof unsubscribeDados === "function"){
        unsubscribeDados();
        unsubscribeDados = null;
    }

    atualizarVisibilidadeTelas();
    atualizarSaudacaoUsuario();
}

function aguardarPrimeiroEstadoAuth(timeoutMs = 10000){
    return new Promise((resolve) => {
        const auth = firebase.auth();
        const aguardandoRedirect = redirectEmAndamento();
        let resolvido = false;
        let unsubscribe = null;

        const finalizar = (user) => {
            if(resolvido) return;
            resolvido = true;
            if(typeof unsubscribe === "function") unsubscribe();
            resolve(user || null);
        };

        unsubscribe = auth.onAuthStateChanged((user) => {
            if(user){
                finalizar(user);
                return;
            }

            if(!aguardandoRedirect){
                finalizar(null);
            }
        });

        window.setTimeout(() => {
            finalizar(auth.currentUser);
        }, timeoutMs);
    });
}

async function inicializarAutenticacao(){
    garantirUIInicializada();

    if(redirectEmAndamento()){
        const authShell = document.getElementById("authShell");
        if(authShell){
            authShell.classList.remove("is-hidden");
        }
    }

    let usuarioInicial = null;

    try {
        usuarioInicial = await concluirRedirectAutenticacao();
    } catch (error) {
        console.error("Erro inesperado ao processar retorno do Google:", error);
    }

    if(!usuarioInicial){
        usuarioInicial = firebase.auth().currentUser;
    }

    if(!usuarioInicial){
        usuarioInicial = await aguardarPrimeiroEstadoAuth();
    }

    if(usuarioInicial){
        await processarUsuarioAutenticado(usuarioInicial);
    } else {
        processarUsuarioDeslogado();
    }

    firebase.auth().onAuthStateChanged(async (user) => {
        if(user) {
            await processarUsuarioAutenticado(user);
            return;
        }

        processarUsuarioDeslogado();
    });
}

inicializarAutenticacao().catch((error) => {
    console.error("Erro ao inicializar autenticação:", error);
    processarUsuarioDeslogado();
});



const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const FIREBASE_ROOT_PATH = "controle-gastos-cartoes";
const NOVO_ITEM_VALUE = "__novo__";
const LISTAS_VERSAO_ATUAL = "sem-padroes-2026-04-01";
const AUTH_REDIRECT_KEY = "controle-gastos-cartoes:auth-redirect";
const PAINEIS_STORAGE_KEY = "controle-gastos-cartoes:paineis";

const cartoesPadrao = [];
const categoriasPadrao = [];

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
let sessaoDados = 0;
let estadoConfirmado = null;
let conectado = false;
let gravacaoEmAndamento = false;
let temEstadoCarregado = false;
let erroSincronizacao = false;
let estadoAdiado;
let envioFila = null;
let timerFila = null;
let timerReconexao = null;
let autenticacaoManualPendente = false;
let lancamentosSelecionados = new Set();

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

let informacoesCartoes = {
    "c6 bank": {
        vencimento: "20",
        melhorCompra: "14"
    },
    "carrefour": {
        vencimento: "03",
        melhorCompra: "27"
    },
    "porto": {
        vencimento: "11",
        melhorCompra: "05"
    },
    "itau": {
        vencimento: "--",
        melhorCompra: "--"
    }
};
const informacoesCartoesIniciais = JSON.parse(JSON.stringify(informacoesCartoes));

function gerarIdSerie(){
    if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `serie-${crypto.randomUUID()}`;
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

        return Object.hasOwn(mapaCartoes, chave) ? mapaCartoes[chave] : texto;
    }

    const mapaCategorias = {
        "alimentacao": "Alimentação",
        "combustivel": "Combustível",
        "lazer": "Lazer"
    };

    return Object.hasOwn(mapaCategorias, chave) ? mapaCategorias[chave] : texto;
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
        informacoesCartoes,
        preferencias: {
            mesAtual,
            anoAtual
        },
        listasVersao: LISTAS_VERSAO_ATUAL
    };
}

function validarEstadoRemoto(estado){
    if(estado !== null && estado !== undefined){
        const campos = ["dados", "cartoes", "categorias", "informacoesCartoes", "preferencias", "listasVersao"];
        if(typeof estado !== "object" || Array.isArray(estado) ||
            !Object.keys(estado).some((chave) => campos.includes(chave))){
            throw new Error("Formato de dados não reconhecido. Verifique o cadastro no Firebase.");
        }
        if(estado.dados !== undefined && estado.dados !== null){
            if(typeof estado.dados !== "object") throw new Error("Formato dos lançamentos não reconhecido.");
            for(const [chaveAno, ano] of Object.entries(estado.dados)){
                if(!/^\d{4}$/.test(chaveAno) || !ano || typeof ano !== "object") throw new Error("Ano dos lançamentos inválido.");
                for(const [chaveMes, mes] of Object.entries(ano)){
                    if(!/^(0|[1-9]|10|11)$/.test(chaveMes)) throw new Error("Mês dos lançamentos inválido.");
                    if(mes === null) continue;
                    if(!Array.isArray(mes) || mes.some((item) => !item || typeof item !== "object" ||
                        !Number.isFinite(item.valor) || !["descricao", "cartao", "categoria"].every((campo) => typeof item[campo] === "string"))){
                        throw new Error("Formato dos lançamentos não reconhecido. Os dados não serão sobrescritos.");
                    }
                }
            }
        }
        for(const campo of ["cartoes", "categorias"]){
            if(estado[campo] != null && (!Array.isArray(estado[campo]) || estado[campo].some((item) => typeof item !== "string"))){
                throw new Error(`Formato de ${campo} não reconhecido. Os dados não serão sobrescritos.`);
            }
        }
    }
}

function aplicarEstadoRemoto(estado, manterPeriodo = false){
    validarEstadoRemoto(estado);
    const cartoesRemotos = Array.isArray(estado?.cartoes) ? estado.cartoes : [];
    const categoriasRemotas = Array.isArray(estado?.categorias) ? estado.categorias : [];

    dados = copiarEstado(estado?.dados || {});
    cartoes = obterListaUnica([...cartoesPadrao, ...cartoesRemotos], "cartao");
    categorias = obterListaUnica([...categoriasPadrao, ...categoriasRemotas], "categoria");
    informacoesCartoes = estado?.informacoesCartoes && typeof estado.informacoesCartoes === "object"
        ? { ...informacoesCartoesIniciais, ...estado.informacoesCartoes }
        : { ...informacoesCartoesIniciais };
    if(!manterPeriodo){
        anoAtual = String(estado?.preferencias?.anoAtual || definirAnoInicial());
        mesAtual = normalizarMes(estado?.preferencias?.mesAtual);
    }
    sincronizarListasComDados();
}

function exigirEstadoPronto(){
    if(gravacaoEmAndamento) throw new Error("Uma gravação está em andamento. Aguarde a confirmação do Firebase.");
    if(!usuarioLogado || !estadoPronto){
        throw new Error("Aguarde o carregamento dos dados do Firebase antes de fazer alterações.");
    }
    if(!conectado) throw new Error("Sem conexão com o Firebase. Os dados não foram enviados; mantenha os campos preenchidos e tente novamente quando a conexão voltar.");
    if(erroSincronizacao) throw new Error("Aguardando a recuperação da sincronização. A tentativa anterior permanece no cache.");
    if(envioFila) throw new Error("Aguarde o envio dos lançamentos pendentes antes de editar ou excluir registros.");
}

function mostrarStatusSincronizacao(mensagem, erro = false){
    const status = document.getElementById("statusSincronizacao");
    if(status){
        status.textContent = mensagem;
        status.classList.toggle("sync-error", erro);
        status.hidden = !erro;
    }
    document.getElementById("appShell")?.classList.toggle("dados-indisponiveis", !temEstadoCarregado);
}

function informarErro(error){
    console.error("Operação interrompida:", error);
    const painel = document.getElementById("erroOperacao");
    if(painel){
        painel.hidden = false;
        painel.textContent = error.message || String(error);
        painel.scrollIntoView?.({ block: "nearest" });
    }
}

async function executarAcao(acao){
    try { await acao(); } catch(error){ informarErro(error); }
}

function copiarEstado(estado){ return JSON.parse(JSON.stringify(estado)); }

// Firebase omite nós vazios e pode representar arrays como objetos de índices.
function assinaturaEstado(estado){
    function normalizar(valor){
        if(valor === null || valor === undefined) return null;
        if(typeof valor !== "object") return valor;
        const pares = Object.keys(valor).sort().map((chave) => [chave, normalizar(valor[chave])])
            .filter(([, item]) => item !== null);
        return pares.length ? Object.fromEntries(pares) : null;
    }
    const { dados, cartoes, categorias, informacoesCartoes, listasVersao } = estado || {};
    return JSON.stringify(normalizar({ dados, cartoes, categorias, informacoesCartoes, listasVersao }));
}

function bloquearInteracao(bloquear){
    document.querySelectorAll("#appShell > section").forEach((secao) => { secao.inert = bloquear; });
    document.getElementById("appShell")?.setAttribute("aria-busy", String(bloquear));
}

function camposFormulario(){
    return Object.fromEntries(["descricao", "cartao", "categoria", "valor", "parcelas"].map((id) =>
        [id, document.getElementById(id)?.value || ""]));
}

function chaveRascunho(){ return `${FIREBASE_ROOT_PATH}:rascunho:${usuarioLogado.uid}`; }

function prefixoFila(uid = usuarioLogado?.uid){
    if(!uid) throw new Error("Entre com sua conta para acessar os lançamentos pendentes.");
    return `${FIREBASE_ROOT_PATH}:fila:${uid}:`;
}

function lerFila(uid = usuarioLogado?.uid){
    const prefixo = prefixoFila(uid);
    const fila = [];
    for(let i = 0; i < localStorage.length; i++){
        const chave = localStorage.key(i);
        if(!chave?.startsWith(prefixo)) continue;
        const item = JSON.parse(localStorage.getItem(chave));
        if(!item || item.uid !== uid || chave !== prefixo + item.id || !Array.isArray(item.lancamentos) || !item.lancamentos.length){
            throw new Error("Não foi possível ler um lançamento pendente no cache. Nenhum registro foi apagado.");
        }
        item.lancamentos.forEach(({ ano, mes, gasto }) => {
            if(!Number.isInteger(ano) || ano < 2026 || ano > 2099 || !Number.isInteger(mes) || mes < 0 || mes > 11){
                throw new Error("Período inválido no cache. O lançamento foi preservado para verificação.");
            }
            validarLancamento(gasto?.descricao, gasto?.cartao, gasto?.categoria, gasto?.valor);
        });
        fila.push(item);
    }
    return fila.sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

function mostrarPendencias(){
    const painel = document.getElementById("lancamentosPendentes");
    if(!painel) return;
    try {
        const fila = usuarioLogado ? lerFila().filter((item) => !estadoConfirmado?.operacoesConfirmadas?.[item.id]) : [];
        painel.hidden = !fila.length;
        painel.innerHTML = fila.length ? `<strong>${fila.length} lançamento(s) salvo(s) neste aparelho, aguardando sincronização.</strong><ul>${fila.map((item) =>
            `<li>${escapeHtml(item.descricao)} — ${formatarMoeda(item.total)}${item.erro ? ` — ${escapeHtml(item.erro)}` : ""}</li>`).join("")}</ul>` : "";
    } catch(error){ informarErro(error); }
}

function agendarEnvioFila(){
    window.clearTimeout(timerFila);
    if(!usuarioLogado) return;
    try { if(!lerFila().length) return; } catch(error){ informarErro(error); return; }
    timerFila = window.setTimeout(() => { sincronizarFila().catch(informarErro); }, 30000);
}

function sincronizarFila(){
    const uid = usuarioLogado?.uid;
    if(envioFila?.uid === uid) return envioFila.promise;
    if(!uid || !conectado || !estadoPronto || erroSincronizacao || gravacaoEmAndamento || editandoIndex !== null) return Promise.resolve();
    const trabalho = { uid, promise: null };
    envioFila = trabalho;
    trabalho.promise = enviarFila(uid).catch((error) => {
        if(usuarioLogado?.uid === uid) informarErro(error);
    }).finally(() => {
        if(envioFila === trabalho) envioFila = null;
        if(usuarioLogado?.uid === uid){ mostrarPendencias(); agendarEnvioFila(); }
    });
    return trabalho.promise;
}

async function enviarFila(uid){
    for(const item of lerFila(uid)){
        if(usuarioLogado?.uid !== uid || !conectado || gravacaoEmAndamento || editandoIndex !== null) return;
        const ref = db.ref(getCaminhoDadosUsuario(uid));
        try {
            // Carrega o estado do servidor antes da transação; nunca restaura o cache sobre o banco.
            const snapshot = await ref.get();
            const remoto = snapshot.val();
            validarEstadoRemoto(remoto);
            if(remoto === null && item.contaComRegistros) throw new Error("O banco retornou vazio. Aguardando verificação da conta; lançamento preservado no cache.");
            let erroTransacao;
            const resultado = await ref.transaction((atual) => {
                if(usuarioLogado?.uid !== uid) return;
                try { validarEstadoRemoto(atual); }
                catch(error){ erroTransacao = error; return; }
                if(atual?.operacoesConfirmadas?.[item.id]) return atual;
                if(atual === null && item.contaComRegistros) return;
                const novo = copiarEstado(atual || {});
                novo.dados = novo.dados || {};
                for(const { ano, mes, gasto } of item.lancamentos){
                    novo.dados[ano] = novo.dados[ano] || {};
                    novo.dados[ano][mes] = novo.dados[ano][mes] || [];
                    novo.dados[ano][mes].push(copiarEstado(gasto));
                }
                novo.cartoes = obterListaUnica([...(novo.cartoes || []), ...item.lancamentos.map(({ gasto }) => gasto.cartao)], "cartao");
                novo.categorias = obterListaUnica([...(novo.categorias || []), ...item.lancamentos.map(({ gasto }) => gasto.categoria)], "categoria");
                novo.operacoesConfirmadas = { ...novo.operacoesConfirmadas, [item.id]: true };
                return novo;
            }, undefined, false);
            if(!resultado.committed) throw erroTransacao || new Error("Sincronização adiada. O lançamento continua no cache.");
            // A confirmação e as parcelas são gravadas na mesma transação. Repetir não duplica.
            localStorage.setItem(`${FIREBASE_ROOT_PATH}:confirmado:${uid}:${item.id}`, "1");
            localStorage.removeItem(prefixoFila(uid) + item.id);
            if(usuarioLogado?.uid === uid){
                if(!gravacaoEmAndamento && editandoIndex === null && !estadoConfirmado?.operacoesConfirmadas?.[item.id]) receberEstadoConfirmado(resultado.snapshot.val());
                const aviso = document.getElementById("erroOperacao");
                if(aviso?.dataset.fila === "true") { aviso.hidden = true; delete aviso.dataset.fila; }
                mostrarPendencias();
            }
        } catch(error){
            if(usuarioLogado?.uid === uid){
                const detalhe = error.code || error.message || "falha de conexão";
                try { localStorage.setItem(prefixoFila(uid) + item.id, JSON.stringify({ ...item, erro: detalhe })); } catch(cacheError){ console.warn("Cache original preservado:", cacheError); }
                informarErro(new Error(`Não foi possível sincronizar: ${detalhe}. O lançamento permanece salvo neste aparelho e será reenviado automaticamente.`));
                const aviso = document.getElementById("erroOperacao");
                if(aviso) aviso.dataset.fila = "true";
            }
            return;
        }
    }
}

function carregarCacheUsuario(){
    try {
        const texto = localStorage.getItem(`${FIREBASE_ROOT_PATH}:ultimo-estado:${usuarioLogado.uid}`);
        if(texto === null) return;
        const estado = JSON.parse(texto);
        validarEstadoRemoto(estado);
        estadoConfirmado = copiarEstado(estado);
        aplicarEstadoRemoto(estado);
        temEstadoCarregado = true;
        atualizarTela();
        restaurarRascunho();
        mostrarPendencias();
    } catch(error){ informarErro(new Error("Não foi possível abrir o cache deste aparelho. Os registros foram preservados; aguardando o Firebase.")); }
}

function guardarRascunho(){
    if(!usuarioLogado || gravacaoEmAndamento) return;
    try {
        localStorage.setItem(chaveRascunho(), JSON.stringify({ campos: camposFormulario(), anoAtual, mesAtual }));
    } catch(error){ informarErro(new Error("Não foi possível guardar o rascunho neste navegador. Não feche a página antes de salvar no Firebase.")); }
}

function restaurarRascunho(){
    try {
        const rascunho = JSON.parse(localStorage.getItem(chaveRascunho()) || "null");
        if(!rascunho) return;
        if(rascunho.operacaoId && (estadoConfirmado?.operacoesConfirmadas?.[rascunho.operacaoId] ||
            localStorage.getItem(`${FIREBASE_ROOT_PATH}:confirmado:${usuarioLogado.uid}:${rascunho.operacaoId}`) ||
            localStorage.getItem(prefixoFila() + rascunho.operacaoId))){
            localStorage.removeItem(chaveRascunho());
            return;
        }
        anoAtual = String(rascunho.anoAtual);
        mesAtual = normalizarMes(rascunho.mesAtual);
        atualizarTela();
        Object.entries(rascunho.campos || {}).forEach(([id, valor]) => {
            const campo = document.getElementById(id);
            if(campo && ["descricao", "cartao", "categoria", "valor", "parcelas"].includes(id)) campo.value = valor;
        });
    } catch(error){ informarErro(new Error("Não foi possível recuperar o rascunho do cache. O conteúdo foi preservado neste aparelho.")); }
}

function mensagemDadosCarregados(){
    const conta = usuarioLogado?.email || obterNomeUsuario();
    const possuiLancamentos = Object.values(dados).some((ano) =>
        Object.values(ano || {}).some((mes) => Array.isArray(mes) && mes.length > 0));
    return possuiLancamentos
        ? `Dados carregados • ${conta} • Período: ${meses[mesAtual]}/${anoAtual}`
        : `Nenhum lançamento encontrado nesta conta (${conta}). Confira se entrou com o mesmo e-mail usado anteriormente.`;
}

async function salvarEstado(proposto){
    exigirEstadoPronto();
    validarEstadoRemoto(proposto);
    const sessao = sessaoDados;
    const base = copiarEstado(estadoConfirmado);
    const candidato = copiarEstado(proposto);
    const operacaoId = gerarIdSerie();
    const chaveBackup = `${FIREBASE_ROOT_PATH}:backup:${usuarioLogado.uid}:${operacaoId}`;
    const backup = { operacaoId, data: new Date().toISOString(), base, candidato, formulario: camposFormulario(), status: "pendente" };
    try {
        localStorage.setItem(chaveBackup, JSON.stringify(backup));
    }
    catch(error){ throw new Error("Não foi possível criar a cópia de segurança local. A gravação foi interrompida; seus campos continuam preenchidos. Libere espaço no navegador e tente novamente."); }
    gravacaoEmAndamento = true;
    bloquearInteracao(true);
    const painelErro = document.getElementById("erroOperacao");
    if(painelErro) painelErro.hidden = true;
    mostrarStatusSincronizacao("Salvando alterações no Firebase…");
    const timer = window.setTimeout(() => {
        if(sessao === sessaoDados && gravacaoEmAndamento){
            informarErro(new Error("O Firebase ainda não confirmou a gravação. Não repita a operação nem feche a página. Os campos e a cópia local foram preservados; aguardando confirmação."));
        }
    }, 15000);
    try {
        const resultado = await db.ref(getCaminhoDadosUsuario()).transaction((atual) => {
            if(sessao !== sessaoDados || assinaturaEstado(atual) !== assinaturaEstado(base)) return;
            return { ...atual, ...candidato, preferencias: atual?.preferencias || candidato.preferencias,
                operacoesConfirmadas: { ...atual?.operacoesConfirmadas, [operacaoId]: true } };
        }, undefined, false);
        if(!resultado.committed) throw new Error("Os dados mudaram em outra sessão. Nada foi sobrescrito. Seus campos foram preservados. Cancele a edição para visualizar os dados atualizados antes de tentar novamente.");
        backup.status = "confirmado";
        try { localStorage.setItem(chaveBackup, JSON.stringify(backup)); } catch(error){ console.warn("Cópia local mantida como pendente:", error); }
        if(sessao !== sessaoDados) throw new Error("A conta mudou durante a gravação. Confira o resultado na conta original antes de repetir a operação.");
        estadoConfirmado = copiarEstado(resultado.snapshot.val());
        aplicarEstadoRemoto(estadoConfirmado, true);
        if(painelErro) painelErro.hidden = true;
        mostrarStatusSincronizacao("Alterações confirmadas pelo Firebase.");
    } catch(error){
        if(sessao === sessaoDados){
            informarErro(new Error(`Não foi possível concluir a gravação. ${error.message || error.code || "Erro de conexão."} Os campos e a tentativa no cache foram mantidos.`));
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
        if(sessao === sessaoDados){
            gravacaoEmAndamento = false;
            bloquearInteracao(false);
            if(!erroSincronizacao && editandoIndex === null) aplicarAtualizacaoAdiada();
        }
    }
}

async function salvarPreferencias(){
    if(!conectado || envioFila) return;
    exigirEstadoPronto();
    const sessao = sessaoDados;
    try {
        await db.ref(`${getCaminhoDadosUsuario()}/preferencias`).update({ anoAtual, mesAtual });
    } catch(error){
        if(sessao === sessaoDados) informarErro(new Error(`Não foi possível salvar o período selecionado (${error.code || "erro de conexão"}).`));
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
    if(gravacaoEmAndamento){ informarErro(new Error("Aguarde a confirmação da gravação antes de sair.")); return; }
    guardarRascunho();
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
    const lancamentos = Object.values(dados).flatMap((ano) =>
        Object.values(ano || {}).flatMap((mes) => Array.isArray(mes) ? mes.filter(Boolean) : []));
    cartoes = obterListaUnica([...cartoesPadrao, ...cartoes, ...lancamentos.map((item) => item.cartao)], "cartao");
    categorias = obterListaUnica([...categoriasPadrao, ...categorias, ...lancamentos.map((item) => item.categoria)], "categoria");
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
    const cartaoSelecionado = selectCartao.value;
    const categoriaSelecionada = selectCategoria.value;

    cartoes = obterListaUnica(cartoes, "cartao");
    categorias = obterListaUnica(categorias, "categoria");

    selectCartao.innerHTML = montarOpcoes(cartoes, "Selecione o Cartão", true);
    selectCategoria.innerHTML = montarOpcoes(categorias, "Tipo de Despesa", true);
    filtroCartao.innerHTML = montarOpcoesFiltro(cartoes, "Todos os cartões");
    filtroCategoria.innerHTML = montarOpcoesFiltro(categorias, "Todas as categorias");

    selectCartao.value = cartaoSelecionado;
    selectCategoria.value = categoriaSelecionada;
    filtroCartao.value = filtros.cartao;
    filtroCategoria.value = filtros.categoria;
}

async function cadastrarNovoItem(tipo){
    exigirEstadoPronto();
    const candidato = copiarEstado(montarEstadoParaPersistencia());
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
    if(/[.#$\[\]\/\u0000-\u001f\u007f]/.test(nomeNormalizado) || ["__proto__", "constructor", "prototype"].includes(normalizarChaveLista(nomeNormalizado))){
        throw new Error("Use um nome sem os caracteres . # $ [ ] / para cadastrar o item.");
    }
    const existe = configuracao.lista.some((item) => normalizarChaveLista(item) === normalizarChaveLista(nomeNormalizado));
    const nomeFinal = existe
        ? configuracao.lista.find((item) => normalizarChaveLista(item) === normalizarChaveLista(nomeNormalizado))
        : nomeNormalizado;

    if(!existe) {
        if(tipo === "cartao") {
            const vencimento = window.prompt("Digite o vencimento do cartão (ex.: 20):");
            if(vencimento === null) {
                document.getElementById(configuracao.selectId).value = "";
                return;
            }

            const melhorCompra = window.prompt("Digite a melhor data de compra do cartão (ex.: 14):");
            if(melhorCompra === null) {
                document.getElementById(configuracao.selectId).value = "";
                return;
            }

            const vencimentoTratado = vencimento.trim();
            const melhorCompraTratada = melhorCompra.trim();

            if(!vencimentoTratado || !melhorCompraTratada) {
                document.getElementById(configuracao.selectId).value = "";
                return;
            }

            if(![vencimentoTratado, melhorCompraTratada].every((dia) => /^\d{1,2}$/.test(dia) && Number(dia) >= 1 && Number(dia) <= 31)){
                throw new Error("Informe dias entre 1 e 31 para vencimento e melhor compra.");
            }
            candidato.informacoesCartoes[normalizarChaveLista(nomeFinal)] = {
                vencimento: vencimentoTratado,
                melhorCompra: melhorCompraTratada
            };
        }

        if(tipo === "cartao") {
            candidato.cartoes = obterListaUnica([...cartoes, nomeFinal], "cartao");
        } else {
            candidato.categorias = obterListaUnica([...categorias, nomeFinal], "categoria");
        }
        await salvarEstado(candidato);
    }

    preencherSelectsFixos();
    document.getElementById(configuracao.selectId).value = nomeFinal;
    guardarRascunho();
}

function inicializarSelectsDinamicos(){
    preencherSelectsFixos();

    document.getElementById("cartao").addEventListener("change", (event) => {
        if(event.target.value === NOVO_ITEM_VALUE) {
            cadastrarNovoItem("cartao").catch((error) => {
                informarErro(error);
            });
        }
    });

    document.getElementById("categoria").addEventListener("change", (event) => {
        if(event.target.value === NOVO_ITEM_VALUE) {
            cadastrarNovoItem("categoria").catch((error) => {
                informarErro(error);
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
        if(!estadoPronto || gravacaoEmAndamento || editandoIndex !== null) return;
        anoAtual = event.target.value;
        guardarRascunho();
        limparSelecao(false);
        salvarPreferencias().catch((error) => {
                informarErro(error);
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
            if(!estadoPronto || gravacaoEmAndamento || editandoIndex !== null) return;
            mesAtual = index;
            guardarRascunho();
            limparSelecao(false);
            salvarPreferencias().catch((error) => {
                informarErro(error);
            });
            editandoIndex = null;
            atualizarTela();
        };
        abasMeses.appendChild(aba);
    });
}

function inicializarFiltros(){
    document.getElementById("filtroDescricao").addEventListener("input", (event) => {
        if(editandoIndex !== null || gravacaoEmAndamento) return;
        filtros.descricao = event.target.value;
        editandoIndex = null;
        atualizarTela();
    });

    document.getElementById("filtroCartao").addEventListener("change", (event) => {
        if(editandoIndex !== null || gravacaoEmAndamento) return;
        filtros.cartao = event.target.value;
        editandoIndex = null;
        fecharFiltros();
        atualizarTela();
    });

    document.getElementById("filtroCategoria").addEventListener("change", (event) => {
        if(editandoIndex !== null || gravacaoEmAndamento) return;
        filtros.categoria = event.target.value;
        editandoIndex = null;
        fecharFiltros();
        atualizarTela();
    });

    document.getElementById("filtroValor").addEventListener("input", (event) => {
        if(editandoIndex !== null || gravacaoEmAndamento) return;
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

function limparFiltros(){
    if(editandoIndex !== null || gravacaoEmAndamento) return;
    filtros.descricao = "";
    filtros.cartao = "";
    filtros.categoria = "";
    filtros.valor = "";
    editandoIndex = null;
    document.getElementById("filtroDescricao").value = "";
    document.getElementById("filtroCartao").value = "";
    document.getElementById("filtroCategoria").value = "";
    document.getElementById("filtroValor").value = "";
    fecharFiltros();
    atualizarTela();
}

function limparSelecao(atualizar = true){
    lancamentosSelecionados.clear();
    if(atualizar) atualizarTela();
}

function alternarSelecaoLancamento(index){
    if(lancamentosSelecionados.has(index)) {
        lancamentosSelecionados.delete(index);
    } else {
        lancamentosSelecionados.add(index);
    }

    atualizarTela();
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

function lerEstadoPaineis(){
    try {
        const valorSalvo = localStorage.getItem(PAINEIS_STORAGE_KEY);
        const estado = JSON.parse(valorSalvo || "{}");
        return estado && typeof estado === "object" ? estado : {};
    } catch (error) {
        console.warn("Não foi possível ler o estado dos painéis:", error);
        return {};
    }
}

function salvarEstadoPainel(painelId, recolhido){
    try {
        const estadoAtual = lerEstadoPaineis();
        estadoAtual[painelId] = recolhido;
        localStorage.setItem(PAINEIS_STORAGE_KEY, JSON.stringify(estadoAtual));
    } catch (error) {
        console.warn("Não foi possível salvar o estado do painel:", error);
    }
}

function aplicarEstadoPainel(painel, recolhido){
    if(!painel) return;

    painel.classList.toggle("is-collapsed", recolhido);

    const botao = painel.querySelector(".panel-toggle");
    if(botao){
        botao.setAttribute("aria-expanded", recolhido ? "false" : "true");
    }
}

function restaurarEstadoPaineis(){
    const estadosSalvos = lerEstadoPaineis();

    document.querySelectorAll(".collapsible-panel[id]").forEach((painel) => {
        if(Object.prototype.hasOwnProperty.call(estadosSalvos, painel.id)){
            aplicarEstadoPainel(painel, Boolean(estadosSalvos[painel.id]));
            return;
        }

        aplicarEstadoPainel(painel, painel.classList.contains("is-collapsed"));
    });
}

function togglePainel(painelId){
    const painel = document.getElementById(painelId);
    if(!painel) return;

    const vaiFechar = !painel.classList.contains("is-collapsed");
    aplicarEstadoPainel(painel, vaiFechar);
    salvarEstadoPainel(painelId, vaiFechar);
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
    const filtrosAtivos = Object.values(filtros).some((valor) => Boolean(String(valor || "").trim()));

    document.querySelectorAll(".filter-toggle").forEach((botao) => {
        const chave = botao.dataset.filterKey;
        const ativo = Boolean(String(filtros[chave] || "").trim());
        botao.classList.toggle("is-active", ativo);
        botao.setAttribute("aria-pressed", ativo ? "true" : "false");
    });

    document.getElementById("limparFiltros").disabled = !filtrosAtivos;
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
        const valorFormatado = formatarMoeda(item.total);

        return `
            <div class="chart-bar-group">
                <div class="chart-bar-wrap">
                    <div class="chart-bar" style="height: ${altura}%;" title="${escapeHtml(item.categoria)}: ${valorFormatado}" aria-label="${escapeHtml(item.categoria)}: ${valorFormatado}">
                        <span class="chart-bar-value">${valorFormatado}</span>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    const labels = dadosGrafico.map((item) => `
        <div class="chart-bar-label-wrap">
            <div class="chart-bar-label" title="${escapeHtml(item.categoria)}">${escapeHtml(item.categoria)}</div>
        </div>
    `).join("");

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
                    <div class="chart-labels">${labels}</div>
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

function obterInformacoesCartao(nomeCartao){
    return informacoesCartoes[normalizarChaveLista(nomeCartao)] || {
        vencimento: "--",
        melhorCompra: "--"
    };
}

function montarMetaCartao(rotulo, valor){
    if(!valor) return "";
    return `<div class="pie-card-meta"><strong>${rotulo}:</strong> ${escapeHtml(valor)}</div>`;
}

function montarCabecalhoCardPizza(cartaoInfo, totalFormatado, extraClass = ""){
    const isResumo = extraClass.includes("summary-card");

    if(isResumo){
        return `
            <div class="pie-card-header pie-card-header-summary">
                <div class="pie-card-title">Total</div>
                <div class="pie-card-total">${totalFormatado}</div>
            </div>
        `;
    }

    const infoCartao = obterInformacoesCartao(cartaoInfo.cartao);

    return `
        <div class="pie-card-header pie-card-header-detailed">
            <div class="pie-card-title">${escapeHtml(cartaoInfo.cartao)}</div>
            ${montarMetaCartao("Vencimento", infoCartao.vencimento)}
            <div class="pie-card-total">${totalFormatado}</div>
            ${montarMetaCartao("Melhor Compra", infoCartao.melhorCompra)}
        </div>
    `;
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
                ${montarCabecalhoCardPizza(cartaoInfo, formatarMoeda(0), extraClass)}
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
            ${montarCabecalhoCardPizza(cartaoInfo, formatarMoeda(cartaoInfo.total), extraClass)}
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
    if(!usuarioLogado || !temEstadoCarregado) throw new Error("Aguarde o primeiro carregamento dos dados da sua conta.");
    if(gravacaoEmAndamento || editandoIndex !== null) throw new Error("Conclua a alteração em andamento antes de adicionar outro lançamento.");
    const descricao = document.getElementById("descricao").value.trim();
    const cartao = document.getElementById("cartao").value;
    const categoria = document.getElementById("categoria").value;
    const valor = Number(document.getElementById("valor").value);
    const parcelas = Number(document.getElementById("parcelas").value || 1);
    validarLancamento(descricao, cartao, categoria, valor);
    if(!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120){
        throw new Error("Informe um número inteiro de parcelas entre 1 e 120.");
    }
    if(Number(anoAtual) + Math.floor((mesAtual + parcelas - 1) / 12) > 2099){
        throw new Error("As parcelas ultrapassam o último ano disponível (2099).");
    }
    const centavos = Math.round(valor * 100);
    if(centavos < parcelas) throw new Error("Cada parcela precisa ter pelo menos R$ 0,01.");
    const lancamentos = [];
    const serieId = parcelas > 1 ? gerarIdSerie() : "";

    for(let i = 0; i < parcelas; i++){
        let mesParcela = mesAtual + i;
        let anoParcela = parseInt(anoAtual, 10);

        while(mesParcela > 11){
            mesParcela -= 12;
            anoParcela++;
        }

        lancamentos.push({ ano: anoParcela, mes: mesParcela, gasto: {
            descricao: montarDescricaoLancamento(descricao, i + 1, parcelas),
            cartao,
            categoria,
            valor: (Math.floor(centavos / parcelas) + (i < centavos % parcelas ? 1 : 0)) / 100,
            serieId,
            serieNumeroParcela: i + 1,
            serieTotalParcelas: parcelas,
            serieDescricaoBase: descricao
        } });
    }

    const item = { id: gerarIdSerie(), uid: usuarioLogado.uid, criadoEm: new Date().toISOString(), descricao, total: valor, lancamentos,
        contaComRegistros: Boolean(estadoConfirmado?.dados && Object.keys(estadoConfirmado.dados).length) };
    try {
        localStorage.setItem(chaveRascunho(), JSON.stringify({ campos: camposFormulario(), anoAtual, mesAtual, operacaoId: item.id }));
        localStorage.setItem(prefixoFila() + item.id, JSON.stringify(item));
    } catch(error){
        throw new Error("Não foi possível guardar este lançamento no cache do aparelho. Nada foi enviado. Os campos foram mantidos; libere espaço no navegador e tente novamente.");
    }
    limparFormulario();
    try { localStorage.removeItem(chaveRascunho()); } catch(error){ console.warn("Não foi possível limpar o rascunho:", error); }
    mostrarPendencias();
    agendarEnvioFila();
    await sincronizarFila();
}

function validarLancamento(descricao, cartao, categoria, valor){
    if(!descricao || !cartao || !categoria || cartao === NOVO_ITEM_VALUE || categoria === NOVO_ITEM_VALUE){
        throw new Error("Preencha a descrição e selecione um cartão e uma categoria cadastrados.");
    }
    if(!Number.isFinite(valor) || valor <= 0 || !Number.isSafeInteger(Math.round(valor * 100)) ||
        Math.abs(valor * 100 - Math.round(valor * 100)) > 0.00001){
        throw new Error("Informe um valor positivo com no máximo duas casas decimais.");
    }
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
                    <button class="inline-action save-button" onclick="executarAcao(() => salvarEdicao(${gasto.originalIndex}))">Salvar</button>
                    <button class="inline-action cancel-button" onclick="cancelarEdicao()">Cancelar</button>
                </div>
            </td>
        </tr>
    `;
}

function renderLinhaVisual(gasto){
    const selecionado = lancamentosSelecionados.has(gasto.originalIndex);

    return `
        <tr class="selectable-row${selecionado ? " is-selected" : ""}">
            <td class="selectable-cell" onclick="alternarSelecaoLancamento(${gasto.originalIndex})" title="Selecionar lançamento para somar">
                <span class="description-button">${escapeHtml(gasto.descricao)}</span>
            </td>
            <td class="selectable-cell" onclick="alternarSelecaoLancamento(${gasto.originalIndex})" title="Selecionar lançamento para somar">${escapeHtml(gasto.cartao)}</td>
            <td>${escapeHtml(gasto.categoria)}</td>
            <td class="selectable-cell" onclick="alternarSelecaoLancamento(${gasto.originalIndex})" title="Selecionar lançamento para somar">${formatarMoeda(gasto.valor)}</td>
            <td class="actions-cell">
                <div class="action-buttons">
                    <button class="icon-button edit-button" onclick="iniciarEdicao(${gasto.originalIndex})" title="Editar lançamento" aria-label="Editar lançamento">&#9998;</button>
                    <button class="icon-button delete-button" onclick="executarAcao(() => remover(${gasto.originalIndex}))" title="Remover lançamento" aria-label="Remover lançamento">X</button>
                </div>
            </td>
        </tr>
    `;
}

function atualizarTela(){
    if(gravacaoEmAndamento) return;
    const camposEdicao = editandoIndex === null ? null : Object.fromEntries(
        ["editDescricao", "editCartao", "editCategoria", "editValor"].map((id) => [id, document.getElementById(id)?.value]));
    criarAbas();
    preencherSelectsFixos();
    atualizarSaudacaoUsuario();

    const lista = document.getElementById("lista");
    lista.innerHTML = "";

    const lancamentosMes = getLancamentosMes().map((gasto, index) => ({ ...gasto, originalIndex: index }));
    const indicesValidos = new Set(lancamentosMes.map((gasto) => gasto.originalIndex));
    lancamentosSelecionados.forEach((index) => {
        if(!indicesValidos.has(index)) lancamentosSelecionados.delete(index);
    });

    const lancamentosFiltrados = getLancamentosFiltrados();
    const itensSelecionados = lancamentosMes.filter((gasto) => lancamentosSelecionados.has(gasto.originalIndex));
    const exibindoSelecao = itensSelecionados.length > 0;
    const total = (exibindoSelecao ? itensSelecionados : lancamentosFiltrados)
        .reduce((acumulado, gasto) => acumulado + gasto.valor, 0);

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
    document.getElementById("totalLabel").innerText = exibindoSelecao
        ? `Total selecionado (${itensSelecionados.length})`
        : "Total do mês";
    document.getElementById("total").innerText = formatarMoeda(total);
    document.getElementById("limparSelecao").disabled = !exibindoSelecao;
    renderizarGraficoCategorias();
    renderizarGraficosPizzaMensais();
    renderizarGraficosPizzaAnuais();
    document.getElementById("ano").value = anoAtual;
    if(camposEdicao) Object.entries(camposEdicao).forEach(([id, valor]) => {
        if(valor !== undefined && document.getElementById(id)) document.getElementById(id).value = valor;
    });
}

function iniciarEdicao(index){
    if(gravacaoEmAndamento || editandoIndex !== null) return;
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
    if(gravacaoEmAndamento) return;
    if(editandoIndex !== null && !window.confirm("Descartar as alterações desta edição? Se uma gravação foi tentada, a cópia local continua disponível.")) return;
    editandoIndex = null;
    aplicarAtualizacaoAdiada();
    atualizarTela();
}

async function salvarEdicao(index){
    exigirEstadoPronto();
    const descricao = document.getElementById("editDescricao").value.trim();
    const cartao = document.getElementById("editCartao").value;
    const categoria = document.getElementById("editCategoria").value;
    const valor = Number(document.getElementById("editValor").value);
    validarLancamento(descricao, cartao, categoria, valor);
    const candidato = copiarEstado(montarEstadoParaPersistencia());

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

        candidato.dados[ref.ano][ref.mes][ref.index] = modo === "ocorrencia"
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

    await salvarEstado(candidato);
    editandoIndex = null;
    aplicarAtualizacaoAdiada();
    atualizarTela();
}

async function remover(index){
    exigirEstadoPronto();
    if(editandoIndex !== null) throw new Error("Conclua ou cancele a edição antes de excluir um lançamento.");
    const candidato = copiarEstado(montarEstadoParaPersistencia());
    if(!dados[anoAtual] || !dados[anoAtual][mesAtual]) return;

    const referenciasSerie = obterSerieLancamento(anoAtual, mesAtual, index);
    const referenciaAtual = referenciasSerie.find((ref) => ref.ano === String(anoAtual) && ref.mes === Number(mesAtual) && ref.index === index);
    if(!referenciaAtual) return;

    const modo = obterModoExclusaoSerie(referenciasSerie);
    if(!modo) return;

    const referenciasParaExcluir = modo === "serie" ? referenciasSerie : [referenciaAtual];
    if(!window.confirm(`Excluir ${referenciasParaExcluir.length} lançamento(s)? Uma cópia local será guardada antes da exclusão.`)) return;
    const agrupadas = new Map();

    referenciasParaExcluir.forEach((ref) => {
        const chave = `${ref.ano}-${ref.mes}`;
        if(!agrupadas.has(chave)) agrupadas.set(chave, []);
        agrupadas.get(chave).push(ref.index);
    });

    agrupadas.forEach((indices, chave) => {
        const [ano, mes] = chave.split("-");
        indices.sort((a, b) => b - a).forEach((indice) => {
            candidato.dados[ano][mes].splice(indice, 1);
        });

        if(candidato.dados[ano][mes].length === 0){
            delete candidato.dados[ano][mes];
        }
    });

    await salvarEstado(candidato);
    limparSelecao(false);
    atualizarTela();
}

async function inicializarApp(){
    if(gravacaoEmAndamento) throw new Error("Aguarde o resultado da gravação antes de recarregar.");
    if(editandoIndex !== null) return;
    garantirUIInicializada();
    if(!temEstadoCarregado) carregarCacheUsuario();
    estadoPronto = false;
    erroSincronizacao = false;
    mostrarStatusSincronizacao("Carregando seus dados do Firebase…");
    assinarDadosUsuario();
    mostrarPendencias();
}

function garantirUIInicializada(){
    if(appInicializado) return;

    inicializarAutenticacaoUI();
    carregarAnos();
    inicializarSelectsDinamicos();
    inicializarFiltros();
    document.querySelector(".card-form")?.addEventListener("input", guardarRascunho);
    document.querySelector(".card-form")?.addEventListener("change", guardarRascunho);
    window.addEventListener("online", () => { sincronizarFila().catch(informarErro); });
    if(typeof navigator !== "undefined" && "serviceWorker" in navigator){
        navigator.serviceWorker.register("./service-worker.js").catch((error) => {
            console.warn("Não foi possível preparar a abertura offline:", error);
        });
    }
    window.addEventListener("storage", (event) => {
        if(usuarioLogado && event.key?.startsWith(prefixoFila())){
            mostrarPendencias();
            sincronizarFila().catch(informarErro);
        }
    });
    document.addEventListener("visibilitychange", () => {
        if(document.visibilityState === "visible") sincronizarFila().catch(informarErro);
    });
    window.addEventListener("beforeunload", (event) => {
        if(gravacaoEmAndamento || editandoIndex !== null){
            event.preventDefault();
            event.returnValue = "";
        }
    });
    restaurarEstadoPaineis();
    atualizarVisibilidadeTelas();
    atualizarTela();
    appInicializado = true;
}

function receberEstadoConfirmado(estado){
    validarEstadoRemoto(estado);
    const primeiroCarregamento = !temEstadoCarregado;
    if(estado === null && temEstadoCarregado && estadoConfirmado?.dados){
        throw new Error("O banco retornou dados vazios após um carregamento com registros. A gravação foi bloqueada. Confira a conta e use a cópia local para verificar seus dados.");
    }
    estadoConfirmado = copiarEstado(estado);
    aplicarEstadoRemoto(estado, !primeiroCarregamento);
    atualizarTela();
    estadoPronto = true;
    temEstadoCarregado = true;
    erroSincronizacao = false;
    if(primeiroCarregamento) restaurarRascunho();
    try {
        localStorage.setItem(`${FIREBASE_ROOT_PATH}:ultimo-estado:${usuarioLogado.uid}`, JSON.stringify(estado));
    } catch(error){ informarErro(new Error("Dados carregados, mas não foi possível atualizar o cache do aparelho. Verifique o espaço disponível no navegador.")); }
    mostrarStatusSincronizacao(conectado ? "" : "Sem conexão. Novos lançamentos serão guardados neste aparelho e sincronizados automaticamente.", !conectado);
    mostrarPendencias();
    sincronizarFila().catch(informarErro);
}

function aplicarAtualizacaoAdiada(){
    if(estadoAdiado === undefined || gravacaoEmAndamento || editandoIndex !== null) return;
    const estado = estadoAdiado;
    estadoAdiado = undefined;
    try { receberEstadoConfirmado(estado); }
    catch(error){ estadoPronto = false; erroSincronizacao = true; informarErro(error); }
}

function assinarDadosUsuario(){
    if(!usuarioLogado) return;

    if(typeof unsubscribeDados === "function"){
        unsubscribeDados();
    }

    const sessao = ++sessaoDados;
    const refDados = db.ref(getCaminhoDadosUsuario());
    const refConexao = db.ref(".info/connected");
    conectado = false;
    estadoAdiado = undefined;
    const listenerConexao = (snapshot) => {
        if(sessao !== sessaoDados) return;
        conectado = snapshot.val() === true;
        if(gravacaoEmAndamento){
            if(!conectado) informarErro(new Error("A conexão caiu durante a gravação. Aguardando confirmação do Firebase; não repita a operação. A cópia local foi preservada."));
            return;
        }
        if(!conectado) mostrarStatusSincronizacao("Sem conexão. Novos lançamentos serão guardados neste aparelho e sincronizados automaticamente.", true);
        else if(estadoPronto && !erroSincronizacao){
            mostrarStatusSincronizacao("");
            sincronizarFila().catch(informarErro);
        }
    };
    const timer = window.setTimeout(() => {
        if(sessao !== sessaoDados || estadoPronto) return;
        mostrarStatusSincronizacao("Aguardando o Firebase. Seus lançamentos pendentes continuam no cache deste aparelho.", true);
    }, 15000);
    const listener = (snapshot) => {
        if(sessao !== sessaoDados) return;
        window.clearTimeout(timer);
        try {
            const estado = snapshot.val();
            if(gravacaoEmAndamento || editandoIndex !== null){
                estadoAdiado = copiarEstado(estado);
                return;
            }
            receberEstadoConfirmado(estado);
        } catch(error){
            falha(error);
        }
    };
    const falha = (error) => {
        if(sessao !== sessaoDados) return;
        window.clearTimeout(timer);
        estadoPronto = false;
        erroSincronizacao = true;
        console.error("Erro ao sincronizar dados do Firebase:", error);
        mostrarStatusSincronizacao(`Não foi possível carregar os dados (${error.code || error.message}). Confira a conexão e as permissões da conta no Firebase.`, true);
        window.clearTimeout(timerReconexao);
        timerReconexao = window.setTimeout(() => {
            if(sessao === sessaoDados && usuarioLogado && !gravacaoEmAndamento && !envioFila) assinarDadosUsuario();
        }, 30000);
    };

    refDados.on("value", listener, falha);
    refConexao.on("value", listenerConexao, falha);
    unsubscribeDados = () => {
        window.clearTimeout(timer);
        refDados.off("value", listener);
        refConexao.off("value", listenerConexao);
        window.clearTimeout(timerReconexao);
    };
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

    if(usuarioLogado?.uid === user.uid && (estadoPronto || gravacaoEmAndamento)) {
        atualizarVisibilidadeTelas();
        return;
    }

    autenticacaoManualPendente = false;
    limparRedirectEmAndamento();
    usuarioLogado = user;
    estadoConfirmado = null;
    estadoAdiado = undefined;
    gravacaoEmAndamento = false;
    temEstadoCarregado = false;
    bloquearInteracao(false);
    limparFormulario();
    estadoPronto = false;
    dados = {};
    cartoes = [];
    categorias = [];
    editandoIndex = null;
    lancamentosSelecionados.clear();
    atualizarVisibilidadeTelas();
    atualizarSaudacaoUsuario();
    await inicializarApp();
}

function processarUsuarioDeslogado(){
    window.clearTimeout(timerFila);
    window.clearTimeout(timerReconexao);
    sessaoDados++;
    usuarioLogado = null;
    estadoPronto = false;
    dados = {};
    cartoes = [];
    categorias = [];
    estadoConfirmado = null;
    estadoAdiado = undefined;
    conectado = false;
    temEstadoCarregado = false;
    gravacaoEmAndamento = false;
    editandoIndex = null;
    erroSincronizacao = false;
    limparFormulario();
    bloquearInteracao(false);

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

const meses = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
const FIREBASE_ROOT = "controle-gastos-cartoes";
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
let usuarioLogado = null;
let dbListenerAtivo = false;

const filtros = {
    descricao: "",
    cartao: "",
    categoria: "",
    valor: ""
};

// 🔐 caminho dinâmico (já preparado pra multiusuário)
function getPath() {
    return `${FIREBASE_ROOT}/${usuarioLogado.uid}`;
}

// ================= UTIL =================

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
    const ano = new Date().getFullYear();
    return String(Math.max(2026, Math.min(ano, 2099)));
}

function normalizarMes(valor){
    const mes = parseInt(valor);
    return (mes >= 0 && mes <= 11) ? mes : new Date().getMonth();
}

// ================= FIREBASE =================

function montarEstadoParaPersistencia(){
    return {
        dados,
        cartoes,
        categorias,
        preferencias: { mesAtual, anoAtual },
        listasVersao: LISTAS_VERSAO_ATUAL
    };
}

function aplicarEstadoRemoto(estado){
    if(!estado) return;

    dados = estado.dados || {};
    cartoes = obterListaUnica(estado.cartoes || [], "cartao");
    categorias = obterListaUnica(estado.categorias || [], "categoria");
    anoAtual = estado.preferencias?.anoAtual || definirAnoInicial();
    mesAtual = normalizarMes(estado.preferencias?.mesAtual);
}

async function salvarEstado(){
    await db.ref(getPath()).update(montarEstadoParaPersistencia());
}

async function carregarEstadoInicial(){
    const snapshot = await db.ref(getPath()).once("value");
    const estado = snapshot.val();

    aplicarEstadoRemoto(estado);

    if(!estado){
        await salvarEstado();
    }
}

// ================= APP =================

function obterListaUnica(lista, tipo){
    const mapa = new Map();

    lista.forEach(item => {
        const val = normalizarItemLista(tipo, item);
        if(!val || itemBloqueado(tipo, val)) return;

        const chave = normalizarChaveLista(val);
        if(!mapa.has(chave)) mapa.set(chave, val);
    });

    return [...mapa.values()].sort((a,b)=>a.localeCompare(b,"pt-BR"));
}

function getLancamentosMes(){
    return dados?.[anoAtual]?.[mesAtual] || [];
}

// ================= CRUD =================

async function adicionarGasto(){
    const descricao = document.getElementById("descricao").value.trim();
    const cartao = document.getElementById("cartao").value;
    const categoria = document.getElementById("categoria").value;
    const valor = parseFloat(document.getElementById("valor").value);
    const parcelas = parseInt(document.getElementById("parcelas").value) || 1;

    if(!descricao || !cartao || !categoria || !valor) return;

    const valorParcela = valor / parcelas;

    for(let i = 0; i < parcelas; i++){
        let mes = mesAtual + i;
        let ano = parseInt(anoAtual);

        while(mes > 11){
            mes -= 12;
            ano++;
        }

        if(!dados[ano]) dados[ano] = {};
        if(!dados[ano][mes]) dados[ano][mes] = [];

        dados[ano][mes].push({
            descricao: `${descricao} (${i+1}/${parcelas})`,
            cartao,
            categoria,
            valor: valorParcela
        });
    }

    await salvarEstado();
    atualizarTela();
}

async function remover(index){
    dados[anoAtual][mesAtual].splice(index,1);
    await salvarEstado();
    atualizarTela();
}

// ================= UI =================

function atualizarTela(){
    console.log("Tela atualizada");
}

// ================= INIT =================

async function inicializarApp(){
    await carregarEstadoInicial();
    atualizarTela();
    estadoPronto = true;
}

// ================= AUTH =================

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        usuarioLogado = user;

        if (!estadoPronto) {
            await inicializarApp();
        }

        if (!dbListenerAtivo) {
            dbListenerAtivo = true;

            db.ref(getPath()).on("value", (snapshot) => {
                if(!estadoPronto) return;

                aplicarEstadoRemoto(snapshot.val());
                atualizarTela();
            });
        }

    } else {
        const provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithPopup(provider);
    }
});
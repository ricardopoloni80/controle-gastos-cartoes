# Sincronização e cache

As inclusões são guardadas no armazenamento do navegador antes de limpar o formulário. Cada inclusão tem uma chave própria por conta e contém todas as parcelas. Não é necessário baixar arquivos, inclusive no celular.

O envio usa uma transação do Realtime Database: acrescenta as parcelas ao estado atual e registra o identificador da operação no mesmo commit. Reenvios do mesmo identificador não acrescentam a compra novamente. O cache só é removido após confirmação. Erros de leitura, escrita ou autenticação mantêm a fila e exibem um aviso.

A fila é retomada ao conectar, voltar ao app, receber atualizações ou após 30 segundos quando houver pendências. O navegador pode suspender o app em segundo plano; nesse caso o envio continua quando ele for reaberto. As pendências pertencem à conta e ao navegador em que foram criadas, até chegarem ao Firebase.

Edições e exclusões exigem conexão e comparam os dados atuais com os que foram carregados, evitando sobrescrever mudanças de outra sessão. Falhas preservam os registros e os campos de edição. Não há exclusão automática das tentativas guardadas no cache.

O service worker permite reabrir os arquivos do app e SDKs sem internet após uma instalação online bem-sucedida. Ele não intercepta requisições de autenticação nem dados do Firebase. Publicar `index.html`, `script.js`, `style.css` e `service-worker.js` juntos, via HTTPS (ou localhost em desenvolvimento).

## Verificações locais

Com Node.js 22 ou superior:

```sh
node --check script.js
node --check service-worker.js
node tests/firebase-sync.test.cjs
node tests/offline-shell.test.cjs
```

Os testes usam Firebase e navegador simulados. Cobrem falhas, cache, reconexão, parcelas, concorrência, reenvio, isolamento entre contas, preservação de campos e arquivos offline. Não validam regras do projeto em produção nem substituem uma verificação em um celular autenticado.

O cache não oferece garantia absoluta: limpeza dos dados do navegador, navegação privada, perda do aparelho ou remoção do armazenamento pelo sistema podem apagar itens ainda não sincronizados. Falta de espaço interrompe a inclusão e mantém os campos preenchidos. O primeiro acesso e o primeiro login precisam de internet.

# NFS-e · Hospedagem

Assistente local para preparar e preencher notas de hospedagem no Emissor Nacional,
seguindo [preenchimento.md](preenchimento.md).

## Índice

- [Iniciar](#iniciar)
- [Extensão do Chrome](#extensão-do-chrome)
- [Pacote Windows sem instalação](#pacote-windows-sem-instalação)
- [Usar](#usar)
- [Configurações e dados locais](#configurações-e-dados-locais)
  - [Desbravador Light Web](#desbravador-light-web--consulta-opcional-por-quarto)
  - [Dados da NFS-e](#dados-da-nfs-e)
- [Integração com o portal](#integração-com-o-portal)
- [Desenvolvimento e testes](#desenvolvimento-e-testes)

## Iniciar

É necessário **Python 3.11 ou superior**. A interface usa somente a biblioteca padrão:

```bash
python run.py
```

O aplicativo abre em **http://127.0.0.1:8765**. Para escolher outra porta ou não abrir
a interface automaticamente:

```bash
python run.py --port 8766 --no-open
```

Para preencher o portal, instale **Chrome/Chromium e ChromeDriver compatíveis**, ambos
disponíveis no `PATH`. Nesta máquina, Chromium e ChromeDriver já foram encontrados.
Os caminhos podem ser definidos explicitamente:

```bash
NFSE_BROWSER_BINARY=/usr/bin/chromium NFSE_CHROMEDRIVER=/usr/bin/chromedriver python run.py
```

Consulte a [documentação oficial do ChromeDriver](https://developer.chrome.com/docs/chromedriver/get-started)
para instalação em outras máquinas. Não é necessário instalar Playwright, Selenium,
Node.js ou pacotes Python para executar o aplicativo.

## Extensão do Chrome

A pasta [`extension/`](extension/) contém uma versão que roda no Chrome normal,
sem iniciar Python, ChromeDriver ou uma janela de navegador separada. Para instalar:

1. Baixe e extraia o repositório no computador Windows.
2. Abra `chrome://extensions`, ative **Modo do desenvolvedor** e clique em
   **Carregar sem compactação**. Escolha a pasta `extension` extraída.
3. Clique no ícone **NFS-e Hospedagem** para abrir o painel lateral. Entre no
   Desbravador e no Emissor Nacional nas abas normais do Chrome.
4. Informe um quarto no painel e clique em **Consultar quarto**. A extensão abre
   o mapa em uma aba temporária, aguarda os cards carregarem,
   abre o quarto, passa por **Extrato de Conta** e acessa a edição da hospedagem.
   Depois lê o titular, CPF, datas e total das diárias e fecha essa aba. Confira o nome
   e troque o CPF pelo CNPJ do tomador se necessário.
5. Prepare a nota no painel. Com a etapa correta da Emissão Completa aberta em
   uma única aba, clique em **Pessoas**, **Serviço** ou **Valores**. Confira e
   avance no portal; a emissão final continua manual.

O campo do quarto é opcional. O painel oferece inspeção estrutural das telas e
mapeamento avançado. Para trazer configurações da página antiga, abra
**Configurações → Importar da página antiga** e selecione `data/settings.json`;
se existir, importe também `data/desbravador.json`. A extensão guarda uma cópia
em `chrome.storage.local`, sem sincronização automática com a página antiga.
Dados da hospedagem consultada ficam na sessão do painel. Senhas e cookies são
administrados pelo próprio Chrome. A versão web (`python run.py`) continua
disponível separadamente. A aba temporária começa em segundo plano; se o menu do
quarto exigir foco, a extensão a ativa por alguns instantes e volta à aba anterior.

Ao alterar mapeamentos compartilhados no código, atualize os arquivos incluídos
na extensão com `python scripts/build_extension.py` antes de distribuir a pasta.
Depois de substituir os arquivos da extensão, clique em **Recarregar** em
`chrome://extensions` antes de consultar outro quarto.

## Pacote Windows sem instalação

O ZIP para Windows inclui o executável, Chrome for Testing e a versão correspondente
do ChromeDriver. No computador de destino, extraia o arquivo e execute
`NfseFiller.exe`; não é preciso instalar Python, Chrome ou bibliotecas. O primeiro
empacotamento precisa ser feito em Windows x64 com Python 3.11+ e acesso à internet.

No PowerShell, dentro da cópia do projeto:

```powershell
.\scripts\build-windows.ps1
```

O script prepara um ambiente temporário de build, baixa as versões estáveis
compatíveis do Chrome for Testing e ChromeDriver e grava
`dist/NfseFiller-Windows-x64.zip`. O pacote inclui os arquivos de licença entregues
com o navegador. O navegador não atualiza sozinho; gere e distribua um pacote novo
para atualizar o par Chrome/ChromeDriver. A página [Chrome for Testing](https://googlechromelabs.github.io/chrome-for-testing/)
publica os downloads e versões pareadas para automação.

O workflow do GitHub Actions também gera o ZIP a cada push para `main` ou quando
executado manualmente. Baixe `NfseFiller-Windows-x64` nos artefatos da execução;
ele fica disponível por 14 dias.

Configurações, perfil do navegador e dados do Desbravador ficam em
`%LOCALAPPDATA%\NfseFiller`, fora da pasta do aplicativo. O executável mantém uma
janela de console aberta; feche essa janela para encerrar o assistente. O pacote
Windows deve ser gerado no Windows, pois o PyInstaller cria executáveis para o
sistema onde é executado.

## Usar

1. Em **Configurações**, confira os padrões trazidos do roteiro e clique em **Salvar configurações**.
2. Em **Nova nota**, informe nome do hóspede, CPF/CNPJ do tomador, competência,
   check-in, check-out e valor total. Check-in e check-out usam **dd/mm/aaaa**,
   com barras inseridas automaticamente ao digitar. Valores aceitam `1.250,00` ou `1250.00`.
3. Clique em **Preparar preenchimento**. Confira a descrição automática e o resumo
   de todos os campos. É possível copiar a descrição ou o resumo.
4. Clique em **Abrir portal** e faça login na janela aberta pelo assistente.
   Acesse **Nova NFS-e → Emissão Completa** e mantenha uma única aba dessa emissão aberta.
5. Com a etapa correspondente aberta no portal, clique em **Pessoas**, **Serviço**
   ou **Valores** no assistente. Confira o resultado e use **Avançar** no próprio portal.
6. Revise os dados e faça a emissão manualmente no portal.

O tomador pode ser diferente do hóspede. O valor informado é o total da hospedagem;
o aplicativo não calcula diárias nem tributos. O roteiro é a origem dos padrões
fiscais, que podem ser editados conforme a configuração do estabelecimento.
São aceitos CPF e CNPJ numéricos, além do CNPJ alfanumérico, com validação de dígitos
conforme o [manual da Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).

## Configurações e dados locais

### Desbravador Light Web — consulta opcional por quarto

Há uma seção **Buscar no Desbravador pelo quarto**, separada do formulário da nota.
O campo de quarto não é obrigatório para preparar ou preencher uma NFS-e. Nenhuma
consulta de hóspede acontece automaticamente ao digitar ou ao preparar a nota.

1. Clique em **Abrir Desbravador**. O endereço inicial é
   `https://desbravadorweb.com.br/acesso/3672`; faça login na janela aberta.
2. Abra o mapa de UH, o extrato ou a edição da hospedagem.
3. Informe o quarto e clique em **Consultar quarto**. No mapa, o sistema identifica
   o número exibido no card e usa o link de edição correspondente. O ID interno do
   card não é tratado como número do quarto. No extrato, usa o link de edição.
4. A consulta lê o titular, as datas e `hospedagemTarifa-totalTarifas`, o total de
   tarifas da hospedagem. Consumos, saldo e total geral da conta não são usados.
   A abreviatura da UH é conferida antes de aceitar os dados.
5. O CPF vem da ficha associada ao titular pelo identificador e nome, ou por um
   nome único quando o identificador não está disponível. A seção da ficha pode
   estar recolhida: os valores já carregados são apenas lidos. O primeiro hóspede
   não é escolhido automaticamente como titular. Se houver ambiguidade ou CPF
   inválido/ausente, o documento deve ser informado manualmente.
6. Nome, CPF, datas e valor são aplicados automaticamente ao concluir a busca.
   Todos continuam editáveis; é possível trocar o CPF pelo CNPJ do tomador e
   alterar o nome. A consulta de status não sobrescreve essas edições.
   Para preservar um CNPJ na próxima consulta, marque **Manter o CPF/CNPJ do
   tomador já informado**. Essa opção vem desmarcada para importar o CPF atual.

Se o formulário for editado enquanto a consulta estiver em andamento, os dados
ficam na prévia, sem sobrescrever as alterações. Use **Aplicar ao formulário**
após conferir. A competência e as configurações fiscais permanecem inalteradas.

O mapeamento padrão foi definido pelos três diagnósticos do Light Web: mapa,
extrato e edição. Configurações inicialmente vazias são migradas para esse padrão;
seletores personalizados são preservados. Em **Conexão e mapeamento**, o campo de
documento pode ficar vazio para usar a associação automática ao titular.

Se a estrutura mudar, use **Inspecionar tela → Baixar diagnóstico** na tela
carregada. O relatório contém metadados estruturais, sem valores digitados,
senhas ou cookies. Os seletores podem ser ajustados e salvos; o subtotal deve
continuar apontando apenas para diárias. Nenhuma API privada é presumida.

O mapeamento e o endereço ficam em `data/desbravador.json`. O perfil separado está
em `data/desbravador-profile/`, sem compartilhar a sessão do emissor NFS-e. O login
é manual e a consulta não lança consumos, fecha contas ou emite documentos no PMS.
Os dados consultados ficam em memória para a prévia, sem histórico persistente.

### Dados da NFS-e

- A última configuração salva fica em `data/settings.json` e é carregada a cada abertura.
- O perfil separado do navegador fica em `data/browser-profile/`; ele pode conter
  cookies e dados da sessão do portal. Não compartilhe essa pasta.
- Os campos da hospedagem ficam apenas na memória da interface e da operação atual.
  Recarregar a página limpa o formulário; dados já enviados ao portal pertencem à sessão do portal.
- Não há campo de senha no assistente. O login acontece diretamente no portal.
- `data/` está no `.gitignore`. Para guardar configurações em outro local, use
  `python run.py --data-dir /caminho/para/dados` ou `NFSE_DATA_DIR`.
- Um arquivo de configurações inválido gera erro e é preservado, sem restaurar os
  padrões silenciosamente. Restaure um backup ou corrija o JSON antes de continuar.

## Integração com o portal

O preenchimento identifica campos pelo rótulo e suporta inputs, radios, selects e
listas pesquisáveis Select2/autocomplete com opções identificáveis. Quando um campo
está ausente, repetido ou não aceita o valor, a operação para, informa o campo e
preserva o que já foi preenchido. Ela não clica em **Avançar** nem em **Emitir**.

Em **Configurações → Mapeamento avançado**, é possível salvar um seletor CSS específico,
por exemplo `#idDoCampo` ou `select[name="NomeDoCampo"]`. Selecione o controle real,
inclusive o `select` por trás de um Select2. Para radios, indique o grupo de uma só
pergunta ou um radio desse grupo. Não use seletores genéricos como `input`.

O roteiro usa o mesmo rótulo para os códigos `000` e `000001`. O assistente tenta
identificar cada select pelas opções disponíveis; se ainda houver ambiguidade,
configure seletores distintos. Campos adicionais exigidos por alterações de regime
ou por atualizações do portal precisam ser conferidos e completados no portal.

Se uma etapa ou campo não for identificado, mantenha essa etapa aberta e clique
em **Inspecionar campos**. Depois, use **Baixar diagnóstico dos campos**. O arquivo
`nfse-campos.json` contém os rótulos associados, IDs, nomes, seletores e indicadores
de visibilidade/bloqueio. A inspeção não preenche campos e não lê seus valores,
cookies ou opções dos selects. O relatório permite conferir os seletores no
mapeamento avançado ou investigar uma mudança no portal.

A etapa Pessoas é reconhecida pela rota `/EmissorNacional/DPS/Pessoas`, sem exigir
que a competência esteja disponível antes da escolha IBS/CBS. A data é localizada
por seus rótulos, associações ARIA ou identificadores semânticos de competência;
nenhuma data de outro significado é escolhida como substituta.

O mapeamento de Pessoas inclui os nomes reais dos controles observados no HTML
do portal, incluindo os radios IBS/CBS com IDs repetidos e inputs ocultos. A seleção
usa o rótulo visível e mantém os grupos de tomador e intermediário separados.
Selects personalizados com Chosen também são reconhecidos. Seletores salvos
manualmente continuam tendo prioridade sobre os padrões internos.

Na etapa Serviço, os seletores de país, município, tributação, NBS, indicador de
operação e descrição também seguem os nomes observados no diagnóstico do portal.
A rota `/EmissorNacional/DPS/Servico` identifica a etapa antes de habilitar os campos
dependentes. O assistente preenche país e município primeiro e aguarda até 30
segundos por campo bloqueado ou em carregamento. Campos continuam protegidos por
`disabled`/`readonly`; esses atributos não são removidos. Repetir o preenchimento
mantém selects já corretos, sem disparar novamente sua mudança de seleção.

A busca de município aguarda a abertura da caixa de pesquisa e digita o nome da
cidade, conferindo a UF na opção escolhida. Os formatos `Alegrete/RS`, `Alegrete - RS`
e `Alegrete (RS)` são equivalentes; municípios de outra UF não são aceitos.

Valores corresponde à rota `/EmissorNacional/DPS/Tributacao`. Seus seletores usam
os nomes do diagnóstico, distinguindo CST/classificação IBS/CBS dos campos de
PIS/COFINS. Opções de rádio bloqueadas são apenas conferidas quando já estão
marcadas conforme a configuração; o assistente não as desbloqueia nem altera.

O preenchimento agora é sequencial com validação: após escrever cada campo, há
uma pausa mínima de 600 ms. Em seguida, o assistente confere o valor sem alterá-lo
e exige estabilidade por mais 600 ms, sem requisições jQuery em andamento ou tela
de carregamento. Se a resposta do portal apagar a seleção, o mesmo campo é
preenchido novamente antes de avançar. O limite dessa sequência é de 30 segundos
por campo; o próximo campo permanece intocado se a confirmação falhar.

Erros transitórios de elemento substituído ou clique bloqueado também provocam
uma nova localização do controle. Sessão encerrada, janela fechada e falha de
script têm mensagens próprias, com indicação do campo onde a sequência parou.

**Validação pendente:** não houve acesso a uma sessão autenticada durante a implementação.
O mapeamento precisa ser conferido no portal real. O ambiente de desenvolvimento também
bloqueou conexões locais, impedindo a prévia visual e os testes com navegador nesta sessão.

## Desenvolvimento e testes

```bash
python -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -B -m pytest -q -p no:cacheprovider
.venv/bin/ruff check --no-cache src tests run.py
.venv/bin/ruff format --check src tests run.py
node --check src/nfse_filler/static/app.js
node --test tests/dates.test.cjs
node --test tests/portal_match.test.cjs
node --test tests/hotel_form.test.cjs
node --test tests/desbravador_data.test.cjs
```

Os testes cobrem validação, valores decimais, persistência após reiniciar, gravação
atômica, API local, configurações concorrentes e interrupção da automação. Os testes
de navegador são opcionais e usam somente páginas locais com dados fictícios:

```bash
NFSE_BROWSER_TESTS=1 .venv/bin/python -B -m pytest tests/test_browser_integration.py -q
```

O código Python está em `src/nfse_filler/`; HTML, CSS e JavaScript estão em
`src/nfse_filler/static/`. A comunicação com ChromeDriver usa o
[protocolo WebDriver](https://www.w3.org/TR/webdriver2/).

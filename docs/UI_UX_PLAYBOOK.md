# Media Uniquifier V2 — Padrões de UI/UX

> Fonte: **UI/UX Playbook — FREE PREVIEW**, UXPeak, PDF de 20 páginas fornecido pelo responsável pelo projeto.
> O arquivo é uma prévia, não a versão completa. As páginas 2–18 têm ensinamentos de design; as páginas 19–20 têm promoção e depoimentos.
> Este documento separa regras extraídas do PDF de aplicações práticas e boas práticas complementares.

## Escopo

Documento de referência para a criação ou alteração de interfaces do repositório `brayanken2025/media-uniquifier-v2`. Não alterar funções já existentes, fluxos de upload, processamento de mídia, áudio, player ou downloads sem necessidade explícita.

## 12 fundamentos extraídos do Playbook

| Tema | Páginas do PDF | Regra |
| --- | --- | --- |
| 1. Hierarquia visual | 2–3 | Usar posição, tamanho, cor, peso tipográfico e contraste para dar prioridade aos dados importantes, não aos seus rótulos. Evitar interfaces planas compostas apenas por pares rótulo/valor. |
| 2. Formulários inspirados no resultado | 4–5 | Agrupar e organizar os campos conforme a maneira como o resultado final será apresentado e utilizado. |
| 3. Thumb zone | 6–7 | Deixar ações principais e frequentes ao alcance confortável do polegar em dispositivos móveis. |
| 4. Estados vazios | 8 | Usar contexto e um CTA de próximo passo, evitando estados sem saída como “nenhum resultado”. |
| 5. Alvos de toque | 9 | Recomenda-se um mínimo de **48 × 48 px** para controles móveis; evitar contatos acidentais. O PDF também dá o exemplo de **32 px de separação** entre ícones pequenos de 24 px. |
| 6. Cards de opções | 10 | Representar escolhas relevantes por cards selecionáveis com rótulos, contexto e sinais visuais claros, quando isso melhorar a comparação. |
| 7. Dropdowns e navegação | 11–12 | Agrupar itens relacionados e usar ícones significativos; usar imagens de maneira seletiva, não indiscriminada. |
| 8. Proximidade | 13 | A distância entre rótulo e campo deve ser menor do que a distância entre conjuntos não relacionados. |
| 9. Comprimento das linhas | 14 | Buscar aproximadamente **45–75 caracteres por linha** em blocos de texto de leitura, ajustando conforme testes reais. |
| 10. Alinhamento de texto | 15 | Centralizar cabeçalhos curtos quando apropriado; preferir alinhamento à esquerda em parágrafos longos. |
| 11. Tipografia | 16–17 | Diferenciar títulos/corpo/botões por tamanho, peso, altura de linha e contraste. O exemplo da página 16 usa 28 px bold/120% no título, 14 px regular/160% no corpo e 14 px semibold no botão — **exemplos, não tokens obrigatórios**. |
| 12. Comprimento dos campos | 18 | Dimensionar cada input segundo os dados esperados; campos de código curto não precisam ter a mesma largura que campos de texto longo. |

## Aplicação prática ao Media Uniquifier V2

### Tela inicial e upload

- Tornar a seleção de mídia a ação mais evidente quando não houver arquivo carregado.
- Exibir tipos compatíveis e instruções concisas sem sobrecarregar o layout.
- Depois do upload, destacar o preview, nome e tamanho do arquivo; permitir substituição do arquivo de maneira clara.
- Manter layout responsivo, sem cortes em vídeo vertical nem textos nas laterais.

### Controles de processamento

- Agrupar opções por objetivo: camada visual, áudio secundário e parâmetros avançados.
- Usar controles com estados ligados/desligados inequívocos e explicações curtas.
- Preservar o áudio original e a opção de uma faixa adicional separada, como atualmente previsto.
- Não deixar configurações secundárias competir visualmente com a ação principal.

### Etapas de processamento

- Exibir claramente a etapa atual e um status legível.
- Mostrar progresso, tempo decorrido, velocidade/FPS e previsão de término **somente quando existirem medições confiáveis**.
- Oferecer feedback explícito de erro, recuperação e, quando tecnicamente implementado, cancelamento.
- Não anunciar “concluído” antes de validar o arquivo gerado.

### Resultado e download

- O player do resultado e o botão **Baixar arquivo** devem ser os elementos dominantes.
- Informações como formato, tamanho e duração podem aparecer em uma linha curta.
- Relatórios, metadados, SHA-256 e diagnósticos devem ficar como conteúdo secundário, acessível sem competir com o download.
- Preservar play/pause, controle de volume e tela cheia quando suportados.

### Adaptação e acessibilidade — boas práticas complementares

Estes critérios complementam, mas não são citações literais do PDF:

- Verificar desktop, tablet e telas mobile estreitas, com áreas de toque confortáveis.
- Garantir rótulos, foco visível, navegação por teclado e feedback dos controles.
- Evitar overflow horizontal, sobreposição de CTAs, textos cortados e movimento desnecessário.
- Priorizar responsividade, tempo de carregamento, estabilidade visual e boa legibilidade.

## Fluxo de desenvolvimento acordado — orientação do projeto, não do PDF

1. Inspecionar branch, estrutura do repositório, arquivos relacionados, dependências e comportamento existente **antes** de qualquer alteração.
2. Delimitar as mudanças e os riscos de regressão. Preservar o que funciona.
3. Planejar e desenvolver aqui no ChatGPT; aplicar commits no GitHub conectado, sem usar créditos da Lovable para desenvolvimento.
4. Executar verificações relevantes: TypeScript, build, testes automatizados e testes funcionais quando possíveis.
5. Usar a Vercel como preview/ambiente publicado; conferir status do deployment e funcionalidades afetadas.
6. Informar arquivos modificados, commit, URL de preview/produção, resultados dos testes e pendências. Um status `READY` não comprova isoladamente a execução correta de todos os fluxos de vídeo.

## Checklist de aceitação visual

- [ ] Hierarquia dos dados, ações e estados compreensível sem esforço.
- [ ] Mobile e desktop sem cortes ou sobreposições.
- [ ] Áreas de toque confortáveis, inclusive em controles pequenos.
- [ ] Estados vazio, carregando, sucesso e erro com orientações úteis.
- [ ] Espaçamentos entre rótulos, campos e grupos consistentes.
- [ ] Tipografia legível, alinhamentos adequados e blocos com comprimento de linha confortável.
- [ ] Botão principal visível e sem concorrência de ações secundárias.
- [ ] Acessibilidade básica, performance e estabilidade de layout verificadas.
- [ ] Nenhuma regressão funcional conhecida introduzida.
- [ ] Testes e limitações reportados com precisão.

**Nota de proveniência:** a tabela dos 12 fundamentos resume o PDF fornecido. As adaptações ao Media Uniquifier, os requisitos técnicos de acessibilidade e o fluxo de engenharia são recomendações para este projeto, não afirmações feitas pelo PDF.

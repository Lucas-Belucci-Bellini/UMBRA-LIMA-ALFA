# Manutenção do projeto UMBRA LIMA ALFA

Ferramentas de limpeza, verificação e reorganização do projeto.

```bash
python3 tools/manutencao/organizar.py --dry-run   # mostra o que faria
python3 tools/manutencao/organizar.py             # aplica
python3 tools/manutencao/validar.py               # confere a integridade
```

| Script | Para que serve |
|---|---|
| `organizar.py` | Corrige os defeitos e reorganiza as coleções |
| `validar.py` | Checa a integridade referencial do projeto inteiro |
| `simular.py` | Simula os chips; usado como rede de segurança antes/depois |

---

## O que foi corrigido

### 1. `'OR-4 '` fundida em `'OR-4'`

Existiam duas chips com o mesmo circuito, diferindo só por um espaço no fim do
nome. As duas são um OR de 4 entradas — confirmado por simulação nas 16
combinações possíveis.

O detalhe perigoso: **os IDs de pino das duas eram diferentes**. Trocar só o
nome nas 4 chips que usavam `'OR-4 '` (`ULA`, `DELAY`, `DELAY1`, `DELAY2`)
deixaria os fios apontando para pinos inexistentes. O script remapeia os IDs
por posição (entrada 0 → entrada 0, e assim por diante) junto com a troca de
nome.

### 2. `'Half Adder '` removida

Duplicata exata de `'Half Adder'`, com os mesmos IDs de pino e nenhuma
referência. Simplesmente sobrava.

### 3. `'Buffer '` renomeada para `'Buffer'`

Sem homônimo e sem referências — só o espaço sobrando no nome.

### 4. `EXERCICIO-ROL8` registrado

O arquivo existia em `Chips/` mas não estava em `AllCustomChipNames`, então o
simulador nunca o carregava: era um chip invisível.

### 5. Duplicatas entre coleções

`Full Subtractor`, `Half Subtractor` e `SR-latch` apareciam em duas coleções
ao mesmo tempo.

### 6. `DLSVersion` normalizado

Antes: 1071 chips em `2.1.6`, 37 **sem versão** e 11 em `2.1.9`.

Chip sem `DLSVersion` é tratado como `2.0.0` pelo simulador e passa pela
migração `UpdateChipPre_2_1_5`, que **remapeia as cores dos pinos a cada
carregamento** (a opção laranja foi inserida no índice 1 e os índices antigos
são deslocados). Os 37 chips sofriam esse deslocamento sem necessidade.
Agora todos declaram `2.1.6`, igual ao projeto.

---

## Reorganização das coleções

As coleções geradas por `tools/generate-chips.js` já eram consistentes e
**não foram tocadas** (`MULTI-GATES`, `GATE BANKS`, `COMPARATORS`, `SHIFTERS`,
`LOGIC UTILS`, `UTILITIES`, etc.).

A bagunça estava nas coleções feitas à mão — `LOGIC`, `OTHER`, `BASIC` e
`ARITHMETIC` eram gavetas de tudo. `LOGIC` misturava porta básica, porta de
3/4 entradas, somador, constante e latch; `OTHER` juntava `DELAY`, `COMPUTER`,
`Teste 1`, `BUZZER` e `ui` no mesmo lugar.

As 4 viraram 8, por função:

| Coleção nova | Conteúdo |
|---|---|
| `PORTAS BASICAS` | NAND, AND, OR, NOT, XOR, XNOR, NOR, `1`, `0` |
| `PORTAS 8 BITS (LEGADO)` | As versões de 8 bits feitas à mão |
| `SOMADORES BASICOS` | Half/Full Adder e os somadores manuais |
| `TEMPORIZACAO` | CLOCK, PULSE, DELAY*, RISE*, T-400 |
| `PROJETOS` | ULA, COMPUTER, COMPUTER-FIB, LFSR, ui |
| `BUFFERS / SELECAO` | 3-STATE BUFFER, Buffer, LONGIFY, MUX legados |
| `ENTRADA / SAIDA FISICA` | KEY, BUZZER |
| `RASCUNHO` | Teste 1, Teste 2, EXERCICIO-ROL8 |

Os chips soltos que já tinham casa foram para a coleção certa: as portas de
3/4 entradas para `MULTI-GATES`, os latches para `FLIP-FLOPS`, os subtratores
para `SUBTRACTORS`, `UP DWN SHIFT` para `SHIFTERS`, os registradores para
`MEMORY`.

Os favoritos (`StarredList`) que apontavam para as coleções dissolvidas foram
trocados pelas novas, para a barra de baixo não ficar vazia.

---

## O que **não** foi mexido

**A ordem de `AllCustomChipNames`.** Havia 54 casos de chip usando outro
definido depois dele na lista. Isso não é problema: o `ChipLibrary` indexa os
chips por nome num `Dictionary`, então a ordem não afeta o carregamento.
Reordenar seria churn sem ganho.

**Os nomes fora de padrão.** Convivem `NAND-8Bits`, `OR-8 Bits`, `NOT-8 Bits`,
`AND-3 8 bits`, `Full Adder - 8 Bits` e `16 para 8 e 4 bits` — grafias
diferentes, português e inglês misturados. Padronizar exigiria renomear os
arquivos e atualizar as referências dentro de outras chips, e alguns nomes
alvo colidiriam com os gerados (`AND-8`, `NOR-4` etc. já existem em
`MULTI-GATES` com outro significado: lá o número é a **quantidade de
entradas**, não a largura do barramento). Fica como decisão do dono do
projeto.

**Os backups versionados.** `Chips.bak-20260518-200625/` (~45 MB),
`ProjectDescription.json.bak` e `ProjectDescription.json.bak-20260518-200625`
continuam onde estavam. O histórico do git já cumpre esse papel, então dá para
removê-los, mas apagar 45 MB de dados é decisão do dono.

---

## Defeito pré-existente encontrado (não corrigido)

**O chip `'1'` está corrompido.**

Ele deveria ser o gerador da constante 1, do mesmo jeito que `'0'` é o da
constante 0. Mas foi sobrescrito por um rascunho de subtrator de 4 bits: hoje
tem duas entradas de 4 bits, dois `Full Subtractor`, dois splits — e
**nenhuma saída**.

`COUNTER` e `DELAY` continuam pedindo a saída `271160628` dele, que é
justamente o ID da saída do chip `'0'` — indício de que o `'1'` original era
uma cópia do `'0'` com um NOT a menos.

A cópia em `Chips.bak-20260518-200625/1.json` já está igualmente corrompida,
então o circuito original não dá para recuperar do backup.

Não corrigi porque reconstruir o `'1'` muda o comportamento de `COUNTER` e
`DELAY` — é mudança de lógica, não de organização. `validar.py` reporta os
dois casos como aviso conhecido, não como falha.

Para corrigir, o `'1'` precisa virar um chip sem entradas e com uma saída de
ID `271160628` valendo 1 (um único `NOT` com a entrada solta já resolve, já
que entrada solta vale 0).

---

## Como a mudança foi verificada

Antes de aplicar, `simular.py` capturou o comportamento de **985 dos 1121
chips** (os outros 136 usam chips sequenciais como `PULSE`, `BUS-8` ou têm
realimentação, e não dá para simular de forma combinacional). Depois de
aplicar, capturou de novo e comparou:

```
983 chips com comportamento idêntico, 27.705 casos conferidos
0 divergências
```

As únicas diferenças são as intencionais: `'Buffer '` → `'Buffer'` (idêntico
em comportamento) e as duas duplicatas removidas.

Como os 4 chips afetados pela fusão da `'OR-4 '` (`ULA`, `DELAY`, `DELAY1`,
`DELAY2`) estão justamente entre os não simuláveis, a garantia para eles é
estrutural: `validar.py` confere que todo endereço de fio aponta para um pino
que existe de fato no chip de destino.

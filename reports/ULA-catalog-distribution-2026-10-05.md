# Relatório detalhado — distribuição do catálogo ULA

**Data:** 2026-10-05 (America/Sao_Paulo)

**Pull request:** [#6](https://github.com/Lucas-Belucci-Bellini/UMBRA-LIMA-ALFA/pull/6) — feat/ula-catalog-30000 → main; estado OPEN, mergeability MERGEABLE.

**CI:** Nenhum workflow GitHub Actions encontrado; nenhuma execução/check reportado na branch.

## Resumo executivo

- **30.000 arquivos JSON** e o mesmo número de chips em `AllCustomChipNames`.
- **28.879 chips KMAP4** (96.2633%): 6 funções do quadro e 28.873 LUTs identificadas por máscara hexadecimal.
- Os outros **1.121 chips** são a base anterior preservada.
- **24 categorias primárias** particionam todos os 30.000 chips sem duplicação.
- A distribuição por coleção é sobreposta: 30.007 vínculos de chips customizados para 29.999 chips classificados; 8 chips pertencem a mais de uma coleção e 1 não pertence a coleção.

## Distribuição exclusiva por categoria principal

Para cada arquivo foi escolhida uma categoria principal: categoria do manifesto do gerador para chips gerados; para chips preexistentes, coleção já presente no projeto, priorizando `TIMERS` em relação a `OTHER`. `EXERCICIO-ROL8` permanece marcado como legado sem coleção. Esta tabela soma exatamente 30.000; percentuais arredondados a quatro casas.

| Categoria principal (exclusiva) | Chips | % do total | Gerados | Legados |
| --- | --- | --- | --- | --- |
| KARNAUGH / 4-VARIÁVEIS | 28879 | 96.2633% | 28879 | 0 |
| COMPARATORS | 203 | 0.6767% | 203 | 0 |
| LOGIC UTILS | 148 | 0.4933% | 148 | 0 |
| GATE BANKS | 105 | 0.3500% | 105 | 0 |
| MULTI-GATES | 89 | 0.2967% | 89 | 0 |
| SHIFTERS | 71 | 0.2367% | 71 | 0 |
| UTILITIES | 71 | 0.2367% | 70 | 1 |
| PARITY / BITCOUNT | 60 | 0.2000% | 60 | 0 |
| SHIFT REGISTERS | 58 | 0.1933% | 58 | 0 |
| MUX / DEMUX | 55 | 0.1833% | 55 | 0 |
| ARITHMETIC+ | 40 | 0.1333% | 40 | 0 |
| LOGIC | 40 | 0.1333% | 0 | 40 |
| COUNTERS | 34 | 0.1133% | 34 | 0 |
| INC / DEC | 34 | 0.1133% | 34 | 0 |
| OTHER | 21 | 0.0700% | 0 | 21 |
| ENCODE / DECODE | 18 | 0.0600% | 18 | 0 |
| SUBTRACTORS | 18 | 0.0600% | 18 | 0 |
| ADDERS | 17 | 0.0567% | 17 | 0 |
| FLIP-FLOPS | 17 | 0.0567% | 17 | 0 |
| MEMORY | 10 | 0.0333% | 0 | 10 |
| TIMERS | 6 | 0.0200% | 0 | 6 |
| ARITHMETIC | 4 | 0.0133% | 0 | 4 |
| BASIC | 1 | 0.0033% | 0 | 1 |
| UNCATEGORIZED / LEGACY | 1 | 0.0033% | 0 | 1 |

## Famílias sequenciais e de registradores

As cinco coleções abaixo contêm **125 chips únicos** (0.4167% do catálogo). Os conjuntos não se sobrepõem neste inventário.

| Família sequencial / registradores | Chips | % do catálogo | Cobertura por largura/tipo |
| --- | --- | --- | --- |
| SHIFT REGISTERS | 58 | 0.1933% | PIPO-10, PIPO-12, PIPO-16, PIPO-2, PIPO-24, PIPO-3, PIPO-32, PIPO-4, PIPO-5, PIPO-6, PIPO-7, PIPO-8, PISO-10, PISO-12, PISO-16, PISO-2, PISO-24, PISO-3, PISO-32, PISO-4, PISO-5, PISO-6, PISO-7, PISO-8, SHIFTREG-10, SHIFTREG-12, SHIFTREG-16, SHIFTREG-24, SHIFTREG-32, SHIFTREG-4, SHIFTREG-5, SHIFTREG-6, SHIFTREG-7, SHIFTREG-8, SIPO-10, SIPO-12, SIPO-16, SIPO-2, SIPO-24, SIPO-3, SIPO-32, SIPO-4, SIPO-5, SIPO-6, SIPO-7, SIPO-8, SISO-10, SISO-12, SISO-16, SISO-2, SISO-24, SISO-3, SISO-32, SISO-4, SISO-5, SISO-6, SISO-7, SISO-8 |
| COUNTERS | 34 | 0.1133% | COUNT-DOWN-10, COUNT-DOWN-12, COUNT-DOWN-16, COUNT-DOWN-2, COUNT-DOWN-24, COUNT-DOWN-3, COUNT-DOWN-32, COUNT-DOWN-4, COUNT-DOWN-5, COUNT-DOWN-6, COUNT-DOWN-7, COUNT-DOWN-8, COUNT-UP-10, COUNT-UP-12, COUNT-UP-16, COUNT-UP-2, COUNT-UP-24, COUNT-UP-3, COUNT-UP-32, COUNT-UP-4, COUNT-UP-5, COUNT-UP-6, COUNT-UP-7, COUNT-UP-8, COUNT-UP-OVF-10, COUNT-UP-OVF-12, COUNT-UP-OVF-16, COUNT-UP-OVF-2, COUNT-UP-OVF-3, COUNT-UP-OVF-4, COUNT-UP-OVF-5, COUNT-UP-OVF-6, COUNT-UP-OVF-7, COUNT-UP-OVF-8 |
| FLIP-FLOPS | 17 | 0.0567% | D-FF, D-FF-10, D-FF-12, D-FF-16, D-FF-2, D-FF-24, D-FF-3, D-FF-32, D-FF-4, D-FF-5, D-FF-6, D-FF-7, D-FF-8, D-FF-EN, JK-FF, SR-FF, T-FF |
| MEMORY | 10 | 0.0333% | 16-REG, 16x16-REG, 256x8-REG, BYTE-REG, MTRX_16-REG, MTRX_REG, REG, SR-latch, SYNC_256x16-RAM, SYNC_BYTE-REG |
| TIMERS | 6 | 0.0200% | 8-DELAY, DELAY, DELAY-RNG, DELAY1, DELAY2, T-400 |

**Leitura das famílias:** os 58 registradores de deslocamento cobrem SIPO, SISO, PIPO, PISO e SHIFTREG em larguras de 2 a 32 bits (conforme cada série); os 34 contadores incluem subida, descida e variantes com overflow; os 17 flip-flops incluem D, T, JK, SR, enable e vetores multi-bit. A coleção MEMORY contém 10 chips legados, inclusive REG/MTRX_REG/BYTE-REG e RAM síncrona. Os 6 chips da coleção TIMERS são chips de atraso já existentes, agora também agrupados como temporizadores.

## Displays de sete segmentos

A coleção `ENCODE / DECODE` tem 18 chips customizados; dois são decodificadores/display de sete segmentos. Cada um expõe as sete saídas `seg-a`–`seg-g` (14 saídas de segmento no conjunto).

| Chip | Saídas | Segmentos |
| --- | --- | --- |
| BCD-7SEG | seg-a, seg-b, seg-c, seg-d, seg-e, seg-f, seg-g | 7 |
| HEX-7SEG | seg-a, seg-b, seg-c, seg-d, seg-e, seg-f, seg-g | 7 |

## Vínculos reais das coleções do projeto

Esta segunda visão reproduz os vínculos de `ProjectDescription.json`. “Itens nativos” são componentes do Digital Logic Sim sem arquivo customizado em `Chips/`; eles não entram no denominador de 30.000.

| Coleção no projeto | JSONs custom | Itens nativos sem JSON | Itens listados |
| --- | --- | --- | --- |
| BASIC | 1 | 3 | 4 |
| IN/OUT | 0 | 6 | 6 |
| MERGE/SPLIT | 0 | 6 | 6 |
| BUS | 0 | 3 | 3 |
| LOGIC | 41 | 1 | 42 |
| DISPLAY | 0 | 4 | 4 |
| MEMORY | 10 | 1 | 11 |
| OTHER | 28 | 2 | 30 |
| ARITHMETIC | 4 | 0 | 4 |
| SUBTRACTORS | 18 | 0 | 18 |
| MULTI-GATES | 89 | 0 | 89 |
| GATE BANKS | 105 | 0 | 105 |
| ADDERS | 17 | 0 | 17 |
| INC / DEC | 34 | 0 | 34 |
| ARITHMETIC+ | 40 | 0 | 40 |
| COMPARATORS | 203 | 0 | 203 |
| MUX / DEMUX | 55 | 0 | 55 |
| ENCODE / DECODE | 18 | 0 | 18 |
| SHIFTERS | 71 | 0 | 71 |
| FLIP-FLOPS | 17 | 0 | 17 |
| COUNTERS | 34 | 0 | 34 |
| SHIFT REGISTERS | 58 | 0 | 58 |
| PARITY / BITCOUNT | 60 | 0 | 60 |
| LOGIC UTILS | 148 | 0 | 148 |
| UTILITIES | 71 | 0 | 71 |
| KARNAUGH / 4-VARIÁVEIS | 28879 | 0 | 28879 |
| TIMERS | 6 | 0 | 6 |

- Vínculos customizados no total: **30.007**; excedem os 30.000 chips porque algumas coleções se sobrepõem.
- Vínculos de itens host/nativos: **26**.
- Sobreposições: 8 chips — seis atrasos também em OTHER e os dois subtratores legados também em LOGIC/OTHER.
- Sem coleção: `EXERCICIO-ROL8`.

## PR e integração contínua

O PR [#6](https://github.com/Lucas-Belucci-Bellini/UMBRA-LIMA-ALFA/pull/6) está aberto contra `main` e GitHub o reporta como `MERGEABLE`. A consulta encontrou **zero workflows**, **zero execuções** e “no checks reported”; portanto, a integração contínua está **não configurada/não executada**, e não deve ser interpretada como aprovada.

Validações locais registradas: `node tools/test-chips.js` (**1.724 testes aprovados**) e `node tools/verify-catalog.js` (**30.000 arquivos e 109.914 referências de subchips verificadas**, sem erro estrutural).

## Arquivos de apoio

- `ULA-catalog-categories-2026-10-05.csv`: contagens por categoria principal, percentuais, origem e exemplos.
- `ULA-chip-category-ledger-2026-10-05.csv`: uma linha por chip, categoria primária, coleções e origem.
- Gerador reproduzível: `tools/report-catalog-distribution.js`.

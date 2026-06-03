# ⬛ UMBRA LIMA ALFA

> Construindo um computador funcional **do zero** — porta lógica por porta lógica — dentro do **Digital Logic Sim**.

[![DLS](https://img.shields.io/badge/Digital%20Logic%20Sim-v2.1.6-22d3ee?style=for-the-badge&labelColor=080f17)](https://sebastian.itch.io/digital-logic-sim)
[![Chips](https://img.shields.io/badge/Chips-1121-f97316?style=for-the-badge&labelColor=080f17)](Chips/)
[![Tema](https://img.shields.io/badge/Arquitetura-de%20Computadores-4ade80?style=for-the-badge&labelColor=080f17)](#)
[![Ecossistema](https://img.shields.io/badge/⬡%20Ecossistema-Baluarte-22d3ee?style=for-the-badge&labelColor=080f17)](https://github.com/Lucas-Belucci-Bellini)

---

## ▌ O que é

**UMBRA LIMA ALFA** é o projeto-mãe da minha jornada de hardware no [Digital Logic Sim](https://sebastian.itch.io/digital-logic-sim) (DLS), o simulador de lógica digital do Sebastian Lague. Aqui eu parto das portas lógicas mais básicas e vou subindo a escada da abstração até chegar a **CPUs completas** — o trabalho por trás dos computadores de **8, 16, 32 e 64 bits** que cito no meu perfil.

São **1121 chips** salvos, construídos um a um.

## ▌ Estrutura

```
UMBRA-LIMA-ALFA/
├── ProjectDescription.json   # metadados do projeto DLS (lista de chips, preferências)
├── Chips/                     # 1121 chips salvos (.json) — a biblioteca completa
├── tools/                     # scripts Node.js para gerar, simular e testar chips
│   ├── generate-chips.js      # geração em lote de chips
│   ├── build-project-description.js
│   ├── simulate.js            # simulação fora do DLS
│   ├── test-chips.js          # testes de corretude
│   └── lib/
└── Chips.bak-*/               # backups automáticos do projeto
```

## ▌ A escada da abstração

Da porta lógica à CPU, cada nível é construído com os blocos do nível anterior:

```
NOT · AND · OR · XOR              ← portas fundamentais
        ↓
SR-latch · REG                    ← memória de 1 bit
        ↓
Adders (2 → 32 bit, ripple)       ← aritmética
Subtractors (2 → 32 bit)
        ↓
MUX · DECODE · ENCODE             ← roteamento de dados
Multiplicadores (2-BIT_MULT…)
        ↓
ULA (ALU)                         ← unidade lógica e aritmética
        ↓
Registradores (16-REG · 16x16-REG · 256x8-REG)
        ↓
            ⮕ CPU
```

## ▌ Como abrir

1. Baixe o **[Digital Logic Sim](https://sebastian.itch.io/digital-logic-sim)** (v2.0+).
2. Copie esta pasta para o diretório de projetos do DLS.
3. Abra o projeto **"UMBRA LIMA ALFA"** dentro do simulador.

> Os scripts em `tools/` permitem gerar, simular e testar chips por fora do DLS, direto no Node.js.

---

<div align="center">

⚔ *Spartan never gives up. Spartan always finishes it.*

[![Perfil](https://img.shields.io/badge/GitHub-Lucas--Belucci--Bellini-22d3ee?style=for-the-badge&logo=github&logoColor=white&labelColor=080f17)](https://github.com/Lucas-Belucci-Bellini)
[![Portas lógicas](https://img.shields.io/badge/🖥%20Portas%20Lógicas-CHIPS%20Sim-f97316?style=for-the-badge&labelColor=080f17)](https://github.com/Lucas-Belucci-Bellini/CHIPS-Digital-Logic-Sim-Lucas-Belucci)

</div>

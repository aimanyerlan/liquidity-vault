# Liquidity Vault

Сквозной учебный проект по Solana (недели 8–15). Основа — шаблон преподавателя 0xnurda/vault-dev.

Program ID (devnet): `GUCvUxSVPPYudrxDT3RLf3ESEwmiFDJ273iwqoNm1YV2`

---
## Неделя 8. Каркас vault

### Что сделано

Написала каркас vault на Anchor 0.31.1. Админ создаёт vault для одного SPL-токена: сразу появляются настройки vault, хранилище токенов и share-токен. Каждый пользователь может создать свою карточку внутри vault. Денег пока никто не вносит, это только структура аккаунтов, на которой будут стоять депозит и вывод следующих недель.

### Схема аккаунтов

```
admin (кошелёк)
  │ вызывает initialize_vault и платит за аккаунты
  ▼
VaultState (PDA)
  ├── authority ──► vault_tokens (токен-аккаунт: сюда лягут внесённые токены)
  ├── mint authority ──► share_mint (share-токен, 6 знаков)
  └── на него ссылается ──► UserCard (PDA, по одной на каждого пользователя)
```

| Аккаунт | Seeds | Что хранит | Кто им распоряжается |
|---|---|---|---|
| VaultState | `["vault", token_mint]` | admin, token_mint, адреса хранилища и share mint, bump, paused | программа; паузу ставит только админ |
| vault_tokens | `["vault_tokens", token_mint]` | внесённые токены | VaultState (PDA) |
| share_mint | `["share_mint", token_mint]` | share-токены | VaultState (PDA) — единственный mint authority |
| UserCard | `["user_card", vault_state, user]` | vault, owner, bump, created_at | пользователь, закрыть может только он |

Главная идея недели: хранилищем и share-токеном владеет PDA `VaultState`. У PDA нет приватного ключа, поэтому подписать за неё может только сама программа. Ни админ, ни кто-то другой не может своей подписью забрать токены или напечатать share-токены.

### Инструкции

| Инструкция | Кто вызывает | Что делает |
|---|---|---|
| `initialize_vault` | админ | создаёт VaultState, хранилище и share mint |
| `create_user_card` | пользователь | создаёт карточку; на паузе падает с ошибкой `VaultPaused` |
| `close_user_card` | владелец карточки | закрывает карточку, рента возвращается ему |
| `set_paused(bool)` | только админ | включает и выключает паузу |

### Мои доработки к заданию

- `created_at`: в карточке хранится время создания (`Clock::get()?.unix_timestamp`).
- `close_user_card`: закрытие карточки с возвратом ренты (`close = user`). Seeds включают адрес пользователя, поэтому чужую карточку закрыть нельзя.
- `paused`: флаг в VaultState и инструкция `set_paused`. Работает только для админа (`has_one = admin`), при паузе новые карточки не создаются.

### Ссылки в Explorer (devnet)

Адреса из одного запуска `yarn test` (каждый запуск создаёт новый vault).

- Программа: https://explorer.solana.com/address/GUCvUxSVPPYudrxDT3RLf3ESEwmiFDJ273iwqoNm1YV2?cluster=devnet
- Токен vault (тестовый): https://explorer.solana.com/address/3xpkSK5W2n3QN7TajMdMN4cfo3w2gxQNR966KD46X5ux?cluster=devnet
- VaultState: https://explorer.solana.com/address/JDDnXB2X2JXap1p1iMhayA3DEDnmw6Co8T73QFa5A4rC?cluster=devnet
- Хранилище токенов: https://explorer.solana.com/address/JBEjXMNjzaC1aW3KQuK3X21v2URAjq1j9EATp62qzj8n?cluster=devnet
- Share mint: https://explorer.solana.com/address/FrvkDzt2AZCAudwzijeZ2M7wgA7853nAHgk5zUhW5qz5?cluster=devnet
- Карточка пользователя A: https://explorer.solana.com/address/2Ae2itUf3jjeEe4z5XqncWKkC2rmpRRACdiruf9BmvRc?cluster=devnet
- Карточка пользователя B: https://explorer.solana.com/address/HhZQNH2U5EtzyCZZ728pcsCTr1SWxt7DSdQuXjSUddko?cluster=devnet
- Транзакция `initialize_vault`: https://explorer.solana.com/tx/3fLXmccP1TsMq5SeFfqCHwiTGewDw4hbGH2jbmE1VdyVco7KBKrDtf9AGJpsmsGgczG7qZ2oQABPTh5NdUUh4xHN?cluster=devnet
- Транзакция `create_user_card` (A): https://explorer.solana.com/tx/55N7CSy9JxtateqxJbVUMp7Xsh2QtW4prMKTSUrTD1bwa9fPjNv2mUJe72Z4zAiaWdT9Kr1sAVE1WPiqnHeAV7jP?cluster=devnet
- Транзакция `create_user_card` (B): https://explorer.solana.com/tx/5Js53CtGUoP7tJvcqMZxXqRiWDSeNWa9mM55QoAHxtibp3hCYqKmkq3LTDdUoPskSnXUqzEvge3qiiQTG6ferzek?cluster=devnet

### Тесты

`yarn test` на devnet: 6 passing.

- vault создаётся;
- у каждого пользователя своя карточка;
- вторая карточка для того же пользователя — ошибка;
- карточка закрывается, рента возвращается;
- не админ не может поставить паузу;
- при паузе карточку создать нельзя, после снятия паузы можно.

### Проверьте себя

**Почему share-токен выпускает программа, а не администратор?**
Mint authority share-токена — PDA VaultState, а не кошелёк админа. Если бы токены мог печатать админ, он выпустил бы себе share-токены и забрал чужие деньги. Программа печатает их только в коде депозита, по правилам.

**Что такое PDA и почему у неё нет приватного ключа?**
PDA — адрес, который считается из seeds и ID программы. Его специально выбирают так, чтобы он не лежал на кривой Ed25519, поэтому подходящего приватного ключа не существует. Подписать за такой адрес может только программа, которой он принадлежит.

**Как найти карточку конкретного пользователя?**
Посчитать адрес по seeds `["user_card", vault_state, user]`. Хранить список пользователей не нужно: адрес карточки всегда можно вычислить заново.


---
## Неделя 9. Депозит и выпуск share-токенов

### Что сделано

Добавила инструкцию `deposit`, которая позволяет пользователю
вносить SPL-токены в vault и получать share-токены пропорционально
своей доле.

Через CPI Transfer токены переводятся в хранилище, а через
CPI MintTo программа выпускает share-токены. После депозита
обновляются данные VaultState и UserCard.

Функционал восьмой недели сохранён.

### Схема депозита

```
User Token Account
    ├── 99% ──► Vault Token Account
    └── 1%  ──► Fee Wallet

VaultState (PDA)
    ├── MintTo ──► User Share Account
    ├── обновляет total_tokens и total_shares
    └── обновляет deposited и shares в UserCard
```

### Изменения в аккаунтах

| Аккаунт | Новые поля | Назначение |
|---|---|---|
| VaultState | total_tokens, total_shares | Учёт токенов и выпущенных shares |
| VaultState | fee_wallet | Адрес аккаунта для комиссии |
| UserCard | deposited, shares | Учёт чистых депозитов и начисленных shares |
| Fee Wallet | PDA: `["fee_wallet", token_mint]` | Хранение комиссии |

### Инструкции

| Инструкция | Кто вызывает | Что делает |
|---|---|---|
| `initialize_vault` | админ | Дополнительно создаёт Fee Wallet |
| `deposit(amount)` | пользователь | Переводит токены, удерживает комиссию и выпускает shares |
| `close_user_card` | владелец карточки | Закрывает только пустую карточку |
| `set_paused(bool)` | админ | Приостанавливает создание карточек и депозиты |

### Формула расчёта shares

Для первого вкладчика:

```
shares = net_amount
```

Для последующих вкладчиков:

```
shares = net_amount * total_shares / total_tokens
```

Где `net_amount` — сумма после вычета комиссии,
а `total_shares` и `total_tokens` — значения до депозита.

Для защиты от арифметического переполнения используется
`u128` и checked-операции.

### Мои доработки к заданию

- Комиссия 1%: переводится в отдельный Fee Wallet.
- Минимальный депозит: 1 токен (1 000 000 минимальных единиц).
- Пауза: администратор может приостановить депозиты.
- Тестирование трёх пользователей с разными суммами.
- Защита от закрытия непустой карточки пользователя.
- Проверка принадлежности и соответствия токен-аккаунтов.

### Ссылки в Explorer (devnet)

- [Программа](https://explorer.solana.com/address/GUCvUxSVPPYudrxDT3RLf3ESEwmiFDJ273iwqoNm1YV2?cluster=devnet)
- [VaultState](https://explorer.solana.com/address/A6hEYge4rCYyLKR2khxJpwbw2iV1KJZqwdXdn8h4XWwW?cluster=devnet)
- [Token Mint](https://explorer.solana.com/address/DKxHZsRzhc8wSYaDdi28P2rgXL2mFpKdQciLvhggYtL9?cluster=devnet)
- [Share Mint](https://explorer.solana.com/address/2JbUZbNPjZY7za8vouEwvE4QGKC6EPc6DE9qUm2zx7Fr?cluster=devnet)
- [Fee Wallet](https://explorer.solana.com/address/2LaP4wNh5UNkWxDru8hwiVKkJXnANxVwkPhVY3mrTJ7F?cluster=devnet)
- [Обновление программы](https://explorer.solana.com/tx/3na2ncVwNx8F3bz8dxPMvBg2EQrLt3xCQZCGazspytqpxcFmkfjC8G2PA3QYwTGEEQbErWHLyANGzE3KiUn8VXWL?cluster=devnet)
- [Initialize Vault](https://explorer.solana.com/tx/22M6ZXJnQbT4g7LXeBNAp5C2G67WNy2chKf3C2u7U6vSYA5t3fKLzFNB2i85S1qBPPNBT1BCNv3WTUueNiJdm9Qu?cluster=devnet)
- [Deposit A](https://explorer.solana.com/tx/XHpD68eQSX4g9KdkUojxFsEdHVd75ZuCFdpm4RGD8EYbX26t1eRNRRboGQVib8T4mxPtsFA9aEtEHF12X1KsSCG?cluster=devnet)
- [Deposit B](https://explorer.solana.com/tx/2ZCHt1KhtpzgNCifeb1a136CaoY6ugU7CXxNbE6u898uvMHqrm34EEoo5gaZEcczVZv7CdnyyCXJe55qUqysvEnP?cluster=devnet)
- [Deposit C](https://explorer.solana.com/tx/4MjHm8q7Q89vZDHQ9FPVRDoBnheK9GDJkTkiDP2K6LhgzAMqvVaa5gFrEF2hazMxt5y5C6gg7nkBqJJRSFg3hS5?cluster=devnet)

### Тесты

- Localnet: 19 passing (13s).
- Devnet: 19 passing (53s).

Результаты первых трёх депозитов:

| Пользователь | Депозит | Комиссия | Shares | Доля |
|---|---:|---:|---:|---:|
| A | 100 | 1 | 99 | 28,57% |
| B | 50 | 0,5 | 49,5 | 14,29% |
| C | 200 | 2 | 198 | 57,14% |
| Итого | 350 | 3,5 | 346,5 | 100% |

Проверено:

- токены переводятся в vault;
- shares начисляются пропорционально;
- комиссия поступает в Fee Wallet;
- депозит без карточки запрещён;
- нулевой депозит запрещён;
- депозит меньше одного токена запрещён;
- при паузе депозит невозможен;
- при изменении баланса vault shares рассчитываются корректно.

### Проверьте себя

**Почему Transfer подписывает пользователь, а MintTo — PDA?**

Пользователь владеет своим токен-аккаунтом, а VaultState PDA
является mint authority для share-токенов.

**Почему нельзя всегда выпускать shares в соотношении 1:1?**

Баланс vault может изменяться независимо от количества shares.
Пропорциональный расчёт учитывает текущую стоимость доли.

**Зачем нужен Fee Wallet?**

Для отдельного хранения комиссии, которая не учитывается
при начислении shares.


---
## Неделя 10 — Withdraw & Burn Shares

### Что сделано

- Реализована инструкция `withdraw` — частичный вывод токенов.
- Реализовано сжигание shares через CPI `Burn`.
- Реализован возврат токенов через CPI `Transfer` с подписью PDA.
- Добавлен пропорциональный расчёт суммы вывода.
- Обновление баланса Vault и UserCard.
- Проверка достаточного количества shares.
- Защита от нулевого вывода и вывода из пустого Vault.

### Формула вывода

`tokens_out = shares_amount × total_tokens / total_shares`

### Схема операции

1. Пользователь указывает количество shares.
2. Контракт рассчитывает количество возвращаемых токенов.
3. Shares пользователя сжигаются.
4. Токены переводятся из Vault пользователю.
5. Обновляются данные VaultState и UserCard.

### Мои доработки

- `withdraw_all` — вывод всех доступных пользователю shares.
- Закрытие пустой UserCard с возвратом rent.
- Запрет вывода при активной паузе.
- Проверка сохранности комиссии после вывода всех токенов.

### Solana Explorer (Devnet)

- [Program](https://explorer.solana.com/address/GUCvUxSVPPYudrxDT3RLf3ESEwmiFDJ273iwqoNm1YV2?cluster=devnet)
- [Vault](https://explorer.solana.com/address/3CUgSCVN4UEwUExfrJ7Yz8sSKSZr4k8Ad7jHLKznhiXQ?cluster=devnet)
- [Token Mint](https://explorer.solana.com/address/FSHWs51onNvKW62GpKKXsoWrHtSfBLaENe95XhrA9556?cluster=devnet)
- [Share Mint](https://explorer.solana.com/address/HkjBVw8D6R5MjmFdVqcPvMpgcHZDQ6MoDKqLrdGXSTQ3?cluster=devnet)
- [Fee Wallet](https://explorer.solana.com/address/3XK3QB6ZYYo5o6mSD3f4Eq969eoTFdjMr9Yxk3Gbrazg?cluster=devnet)
- [Initialize Vault](https://explorer.solana.com/tx/6TYziVpAkUa4npPWXC7p9dyp7ixPrH7AC3ycHHi2mgMhkoePnm3YJn9zoRL88WwMhuVeZfwTGjhFKfx6mgCioog?cluster=devnet)
- [Withdraw A — 50 shares → 100 tokens](https://explorer.solana.com/tx/33gd6DTAXEHRgyPGV38UmDwZTqoHD888kQdHotJn4d7g4VSbyWXw4E93jnoMfyWHm5iYro3jt1x5rgTtY3xNoJtr?cluster=devnet)
- [Withdraw All B — 49.5 shares → 99 tokens](https://explorer.solana.com/tx/31MbamHMG3X7DZYXqwcoMr18H137M8QcW71V64jzWW8qqExNJ16eL4HUiWgNRtg8jcbEEnDXPAbfeUPuRwMYxJco?cluster=devnet)

### Тестирование

- Localnet: 28 passing (16s).
- Devnet: 28 passing (1m).
- Добавлено 9 новых тестов.
- Проверены частичный и полный вывод, недостаток shares, нулевая сумма, пауза, отсутствие карточки, закрытие карточки и опустошение Vault.
- В тестах искусственно увеличен баланс Vault для проверки пропорционального вывода в соотношении 2:1.

### Проверьте себя

**1. Какие CPI используются при выводе?**

`Burn` — сжигание shares пользователя.  
`Transfer` — перевод токенов из Vault пользователю.

**2. Кто подписывает CPI?**

Burn подписывает пользователь — владелец shares. Transfer авторизуется через PDA VaultState с использованием seeds и bump.

**3. Почему администратор не может напрямую вывести токены из Vault?**

Владельцем токен-аккаунта Vault является PDA, а не администратор. В реализованных инструкциях вывод осуществляется через сжигание shares и проверку аккаунтов пользователя.

**Статус:** реализовано и протестировано в Localnet и Devnet. Используются тестовые токены.

---
### Запуск

```
yarn install
anchor build
anchor deploy --provider.cluster devnet
yarn test
```

Кошелёк берётся из `~/.config/solana/id.json`. Ключи и seed-фразы в репозиторий не коммитятся (см. `.gitignore`).
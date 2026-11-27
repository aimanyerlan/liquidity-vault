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

### Запуск

```
yarn install
anchor build
anchor deploy --provider.cluster devnet
yarn test
```

Кошелёк берётся из `~/.config/solana/id.json`. Ключи и seed-фразы в репозиторий не коммитятся (см. `.gitignore`).
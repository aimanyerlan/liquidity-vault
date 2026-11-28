import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getMint,
} from "@solana/spl-token";

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

describe("simple_vault — Weeks 8–10", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userC = Keypair.generate();

  const UNIT = 1_000_000;

  const tokens = (amount: number) =>
    new anchor.BN(Math.round(amount * UNIT));

  let tokenMint: PublicKey;
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;
  let feeWalletPDA: PublicKey;

  const tokenAccounts = new Map<string, PublicKey>();
  const shareAccounts = new Map<string, PublicKey>();

  const cardPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_card"),
        vaultStatePDA.toBuffer(),
        user.toBuffer(),
      ],
      program.programId
    )[0];

  async function fundUser(user: Keypair) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: user.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      })
    );

    await provider.sendAndConfirm(tx, [admin]);
  }

  async function createCard(user: Keypair) {
    return program.methods
      .createUserCard()
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();
  }

  async function setPaused(paused: boolean) {
    return program.methods
      .setPaused(paused)
      .accounts({
        vaultState: vaultStatePDA,
        admin: admin.publicKey,
      } as any)
      .rpc();
  }

  async function deposit(user: Keypair, amount: number) {
    const key = user.publicKey.toBase58();

    return program.methods
      .deposit(tokens(amount))
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(user.publicKey),
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        feeWallet: feeWalletPDA,
        userTokenAccount: tokenAccounts.get(key)!,
        userShareAccount: shareAccounts.get(key)!,
        user: user.publicKey,
      } as any)
      .signers([user])
      .rpc();
  }

  async function expectError(
    action: () => Promise<unknown>,
    expected?: string
  ) {
    let failure: unknown;

    try {
      await action();
    } catch (error) {
      failure = error;
    }

    assert.exists(failure, "Transaction must fail");

    if (expected) {
      assert.include(String(failure), expected);
    }
  }

  before(async () => {
    // Защита от случайного запуска вне локальной сети
    const endpoint = new URL(provider.connection.rpcEndpoint);

    assert.include(
      [
        "localhost",
        "127.0.0.1",
        "[::1]",
        "api.devnet.solana.com"
      ],
      endpoint.hostname,
      "Only localnet and devnet are allowed"
    );

    for (const user of [userA, userB, userC]) {
      await fundUser(user);
    }

    // Создание учебного SPL-токена
    tokenMint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6
    );

    // PDA хранилища
    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    // PDA токен-аккаунта Vault
    [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );

    // PDA share mint
    [shareMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );

    // PDA аккаунта комиссии
    [feeWalletPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_wallet"), tokenMint.toBuffer()],
      program.programId
    );
  });

  // ========================================================
  // WEEK 8
  // ========================================================

  it("initialize_vault: Vault создан", async () => {
    const signature = await program.methods
      .initializeVault()
      .accounts({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint,
        feeWallet: feeWalletPDA,
        admin: admin.publicKey,
      } as any)
      .rpc();

    console.log("Program ID:", program.programId.toBase58());
    console.log("Vault:", vaultStatePDA.toBase58());
    console.log("Token mint:", tokenMint.toBase58());
    console.log("Share mint:", shareMintPDA.toBase58());
    console.log("Fee wallet:", feeWalletPDA.toBase58());
    console.log("Initialize transaction:", signature);

    const vault = await program.account.vaultState.fetch(
      vaultStatePDA
    );

    assert.equal(
      vault.admin.toBase58(),
      admin.publicKey.toBase58()
    );

    assert.equal(
      vault.tokenMint.toBase58(),
      tokenMint.toBase58()
    );

    assert.equal(
      vault.shareMint.toBase58(),
      shareMintPDA.toBase58()
    );

    assert.equal(
      vault.feeWallet.toBase58(),
      feeWalletPDA.toBase58()
    );

    assert.equal(vault.totalTokens.toNumber(), 0);
    assert.equal(vault.totalShares.toNumber(), 0);
    assert.isFalse(vault.paused);

    // Создание тестовых токен-аккаунтов
    for (const user of [userA, userB, userC]) {
      const key = user.publicKey.toBase58();

      const tokenAccount = await createAccount(
        provider.connection,
        admin,
        tokenMint,
        user.publicKey
      );

      const shareAccount = await createAccount(
        provider.connection,
        admin,
        shareMintPDA,
        user.publicKey
      );

      tokenAccounts.set(key, tokenAccount);
      shareAccounts.set(key, shareAccount);

      // Каждый пользователь получает 1000 учебных токенов
      await mintTo(
        provider.connection,
        admin,
        tokenMint,
        tokenAccount,
        admin,
        1000 * UNIT
      );
    }
  });

  it("create_user_card: карточки A и B созданы", async () => {
    for (const user of [userA, userB]) {
      await createCard(user);

      const card = await program.account.userCard.fetch(
        cardPda(user.publicKey)
      );

      assert.equal(
        card.owner.toBase58(),
        user.publicKey.toBase58()
      );

      assert.equal(
        card.vault.toBase58(),
        vaultStatePDA.toBase58()
      );

      assert.isAbove(card.createdAt.toNumber(), 0);
      assert.equal(card.deposited.toNumber(), 0);
      assert.equal(card.shares.toNumber(), 0);
    }

    assert.notEqual(
      cardPda(userA.publicKey).toBase58(),
      cardPda(userB.publicKey).toBase58()
    );
  });

  it("create_user_card: повторная карточка запрещена", async () => {
    await expectError(() => createCard(userA));
  });

  it("close_user_card: пустая карточка закрывается", async () => {
    const card = cardPda(userB.publicKey);

    const before = await provider.connection.getBalance(
      userB.publicKey
    );

    await program.methods
      .closeUserCard()
      .accounts({
        vaultState: vaultStatePDA,
        userCard: card,
        user: userB.publicKey,
      } as any)
      .signers([userB])
      .rpc();

    assert.isNull(
      await program.account.userCard.fetchNullable(card)
    );

    const after = await provider.connection.getBalance(
      userB.publicKey
    );

    assert.isAbove(after, before);
  });

  it("set_paused: обычный пользователь не может поставить паузу", async () => {
    await expectError(
      () =>
        program.methods
          .setPaused(true)
          .accounts({
            vaultState: vaultStatePDA,
            admin: userA.publicKey,
          } as any)
          .signers([userA])
          .rpc(),
      "NotAdmin"
    );
  });

  it("paused: создание карточки приостановлено", async () => {
    await setPaused(true);

    try {
      await expectError(
        () => createCard(userB),
        "VaultPaused"
      );
    } finally {
      await setPaused(false);
    }

    await createCard(userB);
  });

  // ========================================================
  // WEEK 9
  // ========================================================

  it("deposit: A вносит 100 токенов и получает 99 shares", async () => {
    const signature = await deposit(userA, 100);

    console.log("Deposit A transaction:", signature);

    const card = await program.account.userCard.fetch(
      cardPda(userA.publicKey)
    );

    const vault = await program.account.vaultState.fetch(
      vaultStatePDA
    );

    const shares = await getAccount(
      provider.connection,
      shareAccounts.get(userA.publicKey.toBase58())!
    );

    assert.equal(card.deposited.toNumber(), 99 * UNIT);
    assert.equal(card.shares.toNumber(), 99 * UNIT);
    assert.equal(vault.totalTokens.toNumber(), 99 * UNIT);
    assert.equal(vault.totalShares.toNumber(), 99 * UNIT);
    assert.equal(Number(shares.amount), 99 * UNIT);
  });

  it("deposit: B вносит 50 токенов и получает 49.5 shares", async () => {
    const signature = await deposit(userB, 50);

    console.log("Deposit B transaction:", signature);

    const card = await program.account.userCard.fetch(
      cardPda(userB.publicKey)
    );

    assert.equal(card.deposited.toNumber(), 49.5 * UNIT);
    assert.equal(card.shares.toNumber(), 49.5 * UNIT);
  });

  it("deposit: без карточки — ошибка", async () => {
    await expectError(() => deposit(userC, 100));
  });

  it("deposit: C вносит 200 токенов и получает 198 shares", async () => {
    await createCard(userC);

    const signature = await deposit(userC, 200);

    console.log("Deposit C transaction:", signature);

    const card = await program.account.userCard.fetch(
      cardPda(userC.publicKey)
    );

    assert.equal(card.deposited.toNumber(), 198 * UNIT);
    assert.equal(card.shares.toNumber(), 198 * UNIT);
  });

  it("deposit: проверка общего баланса Vault", async () => {
    const vault = await program.account.vaultState.fetch(
      vaultStatePDA
    );

    const vaultTokens = await getAccount(
      provider.connection,
      vaultTokenAccountPDA
    );

    const shareMint = await getMint(
      provider.connection,
      shareMintPDA
    );

    assert.equal(
      vault.totalTokens.toNumber(),
      346.5 * UNIT
    );

    assert.equal(
      vault.totalShares.toNumber(),
      346.5 * UNIT
    );

    assert.equal(
      Number(vaultTokens.amount),
      346.5 * UNIT
    );

    assert.equal(
      Number(shareMint.supply),
      346.5 * UNIT
    );
  });

  it("fee: общая комиссия составляет 3.5 токена", async () => {
    const feeAccount = await getAccount(
      provider.connection,
      feeWalletPDA
    );

    assert.equal(Number(feeAccount.amount), 3.5 * UNIT);
  });

  it("shares: проверка долей трёх пользователей", async () => {
    const totalShares = 346.5 * UNIT;

    const expected = [
      { user: userA, shares: 99, spent: 100 },
      { user: userB, shares: 49.5, spent: 50 },
      { user: userC, shares: 198, spent: 200 },
    ];

    for (const item of expected) {
      const key = item.user.publicKey.toBase58();

      const shareAccount = await getAccount(
        provider.connection,
        shareAccounts.get(key)!
      );

      const tokenAccount = await getAccount(
        provider.connection,
        tokenAccounts.get(key)!
      );

      assert.equal(
        Number(shareAccount.amount),
        item.shares * UNIT
      );

      assert.equal(
        Number(tokenAccount.amount),
        (1000 - item.spent) * UNIT
      );

      const percentage =
        Number(shareAccount.amount) / totalShares * 100;

      console.log(
        `User ${key.slice(0, 8)}: ${percentage.toFixed(2)}%`
      );
    }
  });

  it("deposit: нулевая сумма запрещена", async () => {
    await expectError(
      () => deposit(userA, 0),
      "ZeroAmount"
    );
  });

  it("deposit: сумма меньше одного токена запрещена", async () => {
    await expectError(
      () => deposit(userA, 0.5),
      "DepositTooSmall"
    );
  });

  it("deposit: депозит при паузе запрещён", async () => {
    await setPaused(true);

    try {
      await expectError(
        () => deposit(userA, 10),
        "VaultPaused"
      );
    } finally {
      await setPaused(false);
    }
  });

  it("deposit: недостаточно токенов — ошибка", async () => {
    await expectError(() => deposit(userA, 2000));
  });

  it("close_user_card: непустую карточку закрыть нельзя", async () => {
    await expectError(
      () =>
        program.methods
          .closeUserCard()
          .accounts({
            vaultState: vaultStatePDA,
            userCard: cardPda(userA.publicKey),
            user: userA.publicKey,
          } as any)
          .signers([userA])
          .rpc(),
      "CardNotEmpty"
    );
  });

  it("deposit: пропорциональный расчёт при изменении баланса Vault", async () => {
    // Искусственно увеличиваем баланс учебного Vault,
    // чтобы проверить формулу при соотношении 2:1.
    await mintTo(
      provider.connection,
      admin,
      tokenMint,
      vaultTokenAccountPDA,
      admin,
      346.5 * UNIT
    );

    await deposit(userA, 100);

    const card = await program.account.userCard.fetch(
      cardPda(userA.publicKey)
    );

    const vault = await program.account.vaultState.fetch(
      vaultStatePDA
    );

    // Чистый депозит 99, новых shares — 49.5
    assert.equal(card.deposited.toNumber(), 198 * UNIT);
    assert.equal(card.shares.toNumber(), 148.5 * UNIT);
    assert.equal(vault.totalTokens.toNumber(), 792 * UNIT);
    assert.equal(vault.totalShares.toNumber(), 396 * UNIT);
  });

  // WEEK 10 — после теста изменения цены: 792 tokens / 396 shares.
  function withdrawalAccounts(user: Keypair) {
    const key = user.publicKey.toBase58();
    return { vaultState: vaultStatePDA, userCard: cardPda(user.publicKey),
      vaultTokenAccount: vaultTokenAccountPDA, shareMint: shareMintPDA,
      userTokenAccount: tokenAccounts.get(key)!, userShareAccount: shareAccounts.get(key)!,
      user: user.publicKey } as any;
  }
  const withdraw = (user: Keypair, amount: number) => program.methods
    .withdraw(tokens(amount)).accounts(withdrawalAccounts(user)).signers([user]).rpc();
  const withdrawAll = (user: Keypair) => program.methods
    .withdrawAll().accounts(withdrawalAccounts(user)).signers([user]).rpc();
  async function checkVault(assets: number, shares: number) {
    const state = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(state.totalTokens.toNumber(), assets * UNIT);
    assert.equal(state.totalShares.toNumber(), shares * UNIT);
    assert.equal(Number((await getAccount(provider.connection, vaultTokenAccountPDA)).amount), assets * UNIT);
    assert.equal(Number((await getMint(provider.connection, shareMintPDA)).supply), shares * UNIT);
  }
  it("withdraw: A burns 50 shares and receives 100 tokens", async () => {
    const key = userA.publicKey.toBase58();
    const before = (await getAccount(provider.connection, tokenAccounts.get(key)!)).amount;
    console.log("Withdraw A transaction:", await withdraw(userA, 50));
    const after = (await getAccount(provider.connection, tokenAccounts.get(key)!)).amount;
    assert.equal(Number(after - before), 100 * UNIT);
    assert.equal(Number((await getAccount(provider.connection, shareAccounts.get(key)!)).amount), 98.5 * UNIT);
    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.shares.toNumber(), 98.5 * UNIT);
    assert.equal(card.deposited.toNumber(), 98 * UNIT);
    await checkVault(692, 346);
  });
  it("withdraw: zero rejected", async () => {
    await expectError(() => withdraw(userA, 0), "ZeroAmount");
  });
  it("withdraw: insufficient shares rejected", async () => {
    await expectError(() => withdraw(userA, 99), "InsufficientShares");
  });
  it("withdraw: paused vault rejected", async () => {
    await setPaused(true);
    try { await expectError(() => withdraw(userA, 1), "VaultPaused"); }
    finally { await setPaused(false); }
  });
  it("withdraw_all: B receives 99 tokens", async () => {
    console.log("Withdraw all B transaction:", await withdrawAll(userB));
    const key = userB.publicKey.toBase58();
    assert.equal(Number((await getAccount(provider.connection, tokenAccounts.get(key)!)).amount), 1049 * UNIT);
    assert.equal(Number((await getAccount(provider.connection, shareAccounts.get(key)!)).amount), 0);
    const card = await program.account.userCard.fetch(cardPda(userB.publicKey));
    assert.equal(card.shares.toNumber(), 0);
    assert.equal(card.deposited.toNumber(), 0);
    await checkVault(593, 296.5);
  });
  it("close_user_card: B closes card after withdrawal and receives rent", async () => {
    const card = cardPda(userB.publicKey);
    const before = await provider.connection.getBalance(userB.publicKey);
    await program.methods.closeUserCard().accounts({vaultState: vaultStatePDA, userCard: card, user: userB.publicKey} as any).signers([userB]).rpc();
    assert.isNull(await program.account.userCard.fetchNullable(card));
    assert.isAbove(await provider.connection.getBalance(userB.publicKey), before);
  });
  it("withdraw: without card rejected", async () => {
    await expectError(() => withdraw(userB, 1));
  });
  it("withdraw_all: A and C empty vault, fee wallet unchanged", async () => {
    await withdrawAll(userA);
    await withdrawAll(userC);
    await checkVault(0, 0);
    assert.equal(Number((await getAccount(provider.connection, feeWalletPDA)).amount), 4.5 * UNIT);
  });
  it("withdraw: empty vault rejected", async () => {
    await expectError(() => withdraw(userA, 1), "VaultEmpty");
  });
});
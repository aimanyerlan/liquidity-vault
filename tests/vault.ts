/**
 * Тесты для Simple Vault на devnet
 *
 * Сценарий:
 *   1. Admin создаёт vault (initialize_vault)
 *   2. Пользователи A и B создают свои карточки (create_user_card)
 *   3. Повторное создание карточки A падает
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import { SimpleVault } from "../target/types/simple_vault";

// Переводим SOL от admin → pubkey (обходит rate limit devnet airdrop)
async function fundFromAdmin(
  provider: anchor.AnchorProvider,
  admin: Keypair,
  pubkey: PublicKey,
  lamports = 0.05 * LAMPORTS_PER_SOL
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: pubkey, lamports })
  );
  await provider.sendAndConfirm(tx, [admin]);
}

describe("simple_vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SimpleVault as Program<SimpleVault>;
  const admin = (provider.wallet as anchor.Wallet).payer;
  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const explorer = (kind: "address" | "tx", value: string) =>
    `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;

  let tokenMint: PublicKey;
  let vaultStatePDA: PublicKey;
  let vaultTokenAccountPDA: PublicKey;
  let shareMintPDA: PublicKey;

  const cardPda = (user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("user_card"), vaultStatePDA.toBuffer(), user.toBuffer()],
      program.programId
    )[0];

  before(async () => {
    await fundFromAdmin(provider, admin, userA.publicKey);
    await fundFromAdmin(provider, admin, userB.publicKey);

    tokenMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    [vaultStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );
    [vaultTokenAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_tokens"), tokenMint.toBuffer()],
      program.programId
    );
    [shareMintPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint"), tokenMint.toBuffer()],
      program.programId
    );
  });

  it("initialize_vault: vault создан", async () => {
    const initSig = await program.methods
      .initializeVault()
      .accounts({
        vaultState: vaultStatePDA,
        vaultTokenAccount: vaultTokenAccountPDA,
        shareMint: shareMintPDA,
        tokenMint,
        admin: admin.publicKey,
      } as any)
      .rpc();

    console.log("  Program       :", explorer("address", program.programId.toBase58()));
    console.log("  Token mint    :", explorer("address", tokenMint.toBase58()));
    console.log("  VaultState    :", explorer("address", vaultStatePDA.toBase58()));
    console.log("  Vault tokens  :", explorer("address", vaultTokenAccountPDA.toBase58()));
    console.log("  Share mint    :", explorer("address", shareMintPDA.toBase58()));
    console.log("  initialize tx :", explorer("tx", initSig));  

    const vault = await program.account.vaultState.fetch(vaultStatePDA);
    assert.equal(vault.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(vault.tokenMint.toBase58(), tokenMint.toBase58());
    assert.equal(vault.shareMint.toBase58(), shareMintPDA.toBase58());
  });

  it("create_user_card: у каждого пользователя своя карточка", async () => {
    for (const user of [userA, userB]) {
      const userCard = cardPda(user.publicKey);
      const cardSig = await program.methods
        .createUserCard()
        .accounts({ vaultState: vaultStatePDA, userCard, user: user.publicKey } as any)
        .signers([user])
        .rpc();
      console.log("  UserCard      :", explorer("address", userCard.toBase58()));
      console.log("  create_card tx:", explorer("tx", cardSig));  

      const card = await program.account.userCard.fetch(userCard);
      assert.equal(card.owner.toBase58(), user.publicKey.toBase58());
      assert.equal(card.vault.toBase58(), vaultStatePDA.toBase58());
      assert.isTrue(card.createdAt.toNumber() > 0, "created_at должен быть заполнен");
    }
    assert.notEqual(cardPda(userA.publicKey).toBase58(), cardPda(userB.publicKey).toBase58());
  });

  it("create_user_card: вторая карточка для того же пользователя — ошибка", async () => {
    let failed = false;
    try {
      await program.methods
        .createUserCard()
        .accounts({
          vaultState: vaultStatePDA,
          userCard: cardPda(userA.publicKey),
          user: userA.publicKey,
        } as any)
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "повторная карточка должна быть отклонена");
  });

  it("close_user_card: карточка закрывается, рента возвращается", async () => {
    const userCard = cardPda(userB.publicKey);
    const before = await provider.connection.getBalance(userB.publicKey);

    await program.methods
      .closeUserCard()
      .accounts({ vaultState: vaultStatePDA, userCard, user: userB.publicKey } as any)
      .signers([userB])
      .rpc();

    assert.isNull(await program.account.userCard.fetchNullable(userCard));
    const after = await provider.connection.getBalance(userB.publicKey);
    assert.isTrue(after > before, "рента должна вернуться владельцу");
  });

  it("set_paused: не админ не может поставить паузу", async () => {
    let failed = false;
    try {
      await program.methods
        .setPaused(true)
        .accounts({ vaultState: vaultStatePDA, admin: userA.publicKey } as any)
        .signers([userA])
        .rpc();
    } catch {
      failed = true;
    }
    assert.isTrue(failed, "не админ не должен ставить паузу");
  });

  it("paused: при паузе карточку создать нельзя, после снятия паузы можно", async () => {
    await program.methods
      .setPaused(true)
      .accounts({ vaultState: vaultStatePDA, admin: admin.publicKey } as any)
      .rpc();
    assert.isTrue((await program.account.vaultState.fetch(vaultStatePDA)).paused);

    let errMsg = "";
    try {
      await program.methods
        .createUserCard()
        .accounts({
          vaultState: vaultStatePDA,
          userCard: cardPda(userB.publicKey),
          user: userB.publicKey,
        } as any)
        .signers([userB])
        .rpc();
    } catch (e: any) {
      errMsg = String(e);
    }
    assert.include(errMsg, "VaultPaused");

    await program.methods
      .setPaused(false)
      .accounts({ vaultState: vaultStatePDA, admin: admin.publicKey } as any)
      .rpc();

    // userB закрыл карточку раньше, теперь может создать заново
    await program.methods
      .createUserCard()
      .accounts({
        vaultState: vaultStatePDA,
        userCard: cardPda(userB.publicKey),
        user: userB.publicKey,
      } as any)
      .signers([userB])
      .rpc();
  });
});

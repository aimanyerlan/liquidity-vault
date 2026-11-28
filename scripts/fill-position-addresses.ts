/**
 * Неделя 11: достаёт адреса позиции из уже отправленной транзакции открытия
 * и дописывает их в devnet-pool.json.
 *
 * Запуск:
 *   yarn ts-node scripts/fill-position-addresses.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const POOL_FILE = path.join(__dirname, "..", "devnet-pool.json");

async function main() {
  const saved = JSON.parse(fs.readFileSync(POOL_FILE, "utf-8"));
  const { positionTx, clmmProgram } = saved;
  if (!positionTx) throw new Error("В devnet-pool.json нет positionTx");

  const connection = new Connection(RPC_URL, "confirmed");
  const tx = await connection.getParsedTransaction(positionTx, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) throw new Error("Транзакция не найдена (подожди минуту и запусти ещё раз)");

  if (tx.meta?.err) {
    console.log("Транзакция ПРОВАЛИЛАСЬ:", JSON.stringify(tx.meta.err));
    console.log("Позиция не открыта. Пришли этот вывод.");
    return;
  }
  console.log("Транзакция успешна (Success).");

  // NFT позиции: токен с 0 знаков после запятой, который появился в этой транзакции
  const nftBalance = (tx.meta?.postTokenBalances ?? []).find(
    (b) => b.uiTokenAmount.decimals === 0 && b.uiTokenAmount.amount === "1"
  );
  if (!nftBalance) throw new Error("NFT позиции в транзакции не найден");
  const nftMint = new PublicKey(nftBalance.mint);

  // Аккаунт позиции в программе Raydium CLMM: seeds ["position", nft_mint]
  const [personalPosition] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), nftMint.toBuffer()],
    new PublicKey(clmmProgram)
  );

  // Проверяем, что такой аккаунт существует и принадлежит Raydium CLMM
  const info = await connection.getAccountInfo(personalPosition);
  if (!info) throw new Error("Аккаунт позиции не найден: адрес посчитан неверно");
  console.log("Владелец аккаунта позиции:", info.owner.toBase58());

  saved.positionNftMint = nftMint.toBase58();
  saved.personalPosition = personalPosition.toBase58();
  saved.positionStatus = "open";
  fs.writeFileSync(POOL_FILE, JSON.stringify(saved, null, 2) + "\n");

  console.log("\nNFT позиции  :", nftMint.toBase58());
  console.log("  https://explorer.solana.com/address/" + nftMint.toBase58() + "?cluster=devnet");
  console.log("Position PDA :", personalPosition.toBase58());
  console.log("  https://explorer.solana.com/address/" + personalPosition.toBase58() + "?cluster=devnet");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

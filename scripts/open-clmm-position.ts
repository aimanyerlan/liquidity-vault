/**
 * Неделя 11: открыть позицию в своём CLMM-пуле на Raydium (devnet) со своего кошелька.
 *
 * Что делает скрипт:
 *   1. Читает devnet-pool.json (poolId, tickLower, tickUpper)
 *   2. Открывает позицию в этом диапазоне (кладёт TOKEN_A и нужное количество TOKEN_B)
 *   3. Дописывает адреса позиции обратно в devnet-pool.json
 *
 * Запуск:
 *   yarn open-position
 *
 * Кошелёк: ANCHOR_WALLET или ~/.config/solana/id.json. RPC: DEVNET_RPC или публичный devnet.
 */

import { Connection, Keypair } from "@solana/web3.js";
import { Raydium, DEV_API_URLS, TxVersion, PoolUtils } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import Decimal from "decimal.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Настройки
// ─────────────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.DEVNET_RPC ?? "https://api.devnet.solana.com";
const POOL_FILE = path.join(__dirname, "..", "devnet-pool.json");
const INPUT_AMOUNT = 10_000; // сколько mintA кладём в позицию (целых токенов)
const SLIPPAGE = 0.01; // 1%: максимум, на сколько может вырасти нужная сумма второго токена

function loadWallet(): Keypair {
  const keyPath = process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config", "solana", "id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf-8"))));
}

async function main() {
  const owner = loadWallet();
  const connection = new Connection(RPC_URL, "confirmed");
  console.log("Кошелёк:", owner.publicKey.toBase58());
  console.log("Баланс :", (await connection.getBalance(owner.publicKey)) / 1e9, "SOL");

  // ─── 1. Читаем пул и диапазон ──────────────────────────────────────────────
  const saved = JSON.parse(fs.readFileSync(POOL_FILE, "utf-8"));
  const { poolId, tickLower, tickUpper } = saved;
  if (!poolId || tickLower === undefined || tickUpper === undefined) {
    throw new Error("В devnet-pool.json нет poolId, tickLower или tickUpper");
  }
  console.log("\nПул:", poolId);
  console.log("Диапазон (тики):", tickLower, "…", tickUpper);

  // ─── 2. Открываем позицию ──────────────────────────────────────────────────
  const raydium = await Raydium.load({
    owner,
    connection,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "finalized",
    urlConfigs: DEV_API_URLS,
  });

  const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
  const poolInfo: any = data.poolInfo;
  const poolKeys: any = data.poolKeys;

  const rpcData = await raydium.clmm.getRpcClmmPoolInfo({ poolId });
  poolInfo.price = rpcData.currentPrice;
  console.log("Текущая цена пула:", poolInfo.price);

  const baseAmount = new BN(new Decimal(INPUT_AMOUNT).mul(10 ** poolInfo.mintA.decimals).toFixed(0));
  const epochInfo = await raydium.fetchEpochInfo();

  // Сколько второго токена нужно для такой суммы первого в этом диапазоне
  const res = await PoolUtils.getLiquidityAmountOutFromAmountIn({
    poolInfo,
    slippage: SLIPPAGE,
    inputA: true,
    tickUpper,
    tickLower,
    amount: baseAmount,
    add: true,
    amountHasFee: true,
    epochInfo,
  });
  console.log("Нужно второго токена (с запасом):", res.amountSlippageB.amount.toString());

  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    tickUpper,
    tickLower,
    base: "MintA",
    ownerInfo: { useSOLBalance: true },
    baseAmount,
    otherAmountMax: res.amountSlippageB.amount,
    txVersion: TxVersion.V0,
    computeBudgetConfig: { units: 600000, microLamports: 100000 },
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log("Tx:", `https://explorer.solana.com/tx/${txId}?cluster=devnet`);

  // ─── 3. Сохраняем адреса позиции ───────────────────────────────────────────
  const addr = (extInfo as any).address ?? {};
  console.log("Адреса из ответа SDK:", Object.keys(addr).join(", "));

  const nftMint = String(addr.nftMint ?? "");
  const personalPosition = String(addr.personalPosition ?? "");

  saved.positionNftMint = nftMint || null;
  saved.personalPosition = personalPosition || null;
  saved.positionTx = txId;
  saved.positionStatus = "open";
  fs.writeFileSync(POOL_FILE, JSON.stringify(saved, null, 2) + "\n");

  console.log("\nГотово.");
  console.log("NFT позиции   :", nftMint, `https://explorer.solana.com/address/${nftMint}?cluster=devnet`);
  console.log("Position PDA  :", personalPosition, `https://explorer.solana.com/address/${personalPosition}?cluster=devnet`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
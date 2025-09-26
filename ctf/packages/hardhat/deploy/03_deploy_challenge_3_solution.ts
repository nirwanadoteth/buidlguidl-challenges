import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const chainId = Number(await hre.getChainId());
  const isLocal = ["localhost", "hardhat"].includes(hre.network.name) || chainId === 31337;

  // Known Challenge3 addresses by chainId
  const CH3_ADDRS: Record<number, string> = {
    // Optimism mainnet (chainId 10)
    10: "0x03bF70f50fcF9420f27e31B47805bbd8f2f52571",
  };

  const ch3 = isLocal ? (await get("Challenge3")).address : CH3_ADDRS[chainId];

  if (!ch3) {
    throw new Error(`Challenge3 address not configured for chainId ${chainId} (${hre.network.name}).`);
  }

  await deploy("Challenge3Solution", {
    from: deployer,
    args: [ch3],
    log: true,
    autoMine: isLocal,
  });

  console.log("🚩 Challenge 3 Solution contract deployed");
};

export default func;
func.tags = ["solution3"];
func.dependencies = ["Challenge3"]; // ensure local Challenge3 is deployed first

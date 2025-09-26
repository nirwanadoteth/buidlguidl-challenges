import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const chainId = Number(await hre.getChainId());
  const isLocal = ["localhost", "hardhat"].includes(hre.network.name) || chainId === 31337;

  // Known Challenge3 addresses by chainId
  const CH5_ADDRS: Record<number, string> = {
    // Optimism mainnet (chainId 10)
    10: "0xB76AdFe9a791367A8fCBC2FDa44cB1a2c39D8F59",
  };

  const ch5 = isLocal ? (await get("Challenge5")).address : CH5_ADDRS[chainId];

  if (!ch5) {
    throw new Error(`Challenge5 address not configured for chainId ${chainId} (${hre.network.name}).`);
  }

  await deploy("Challenge5Solution", {
    from: deployer,
    args: [ch5],
    log: true,
    autoMine: true,
  });

  console.log("🚩 Challenge 5 Solution contract deployed");
};

export default func;
func.tags = ["solution5"];
func.dependencies = ["Challenge3"]; // ensure local Challenge3 is deployed first

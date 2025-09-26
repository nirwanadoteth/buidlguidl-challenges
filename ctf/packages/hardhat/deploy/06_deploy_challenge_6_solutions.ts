import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const chainId = Number(await hre.getChainId());
  const isLocal = ["localhost", "hardhat"].includes(hre.network.name) || chainId === 31337;

  // Known Challenge3 addresses by chainId
  const CH6_ADDRS: Record<number, string> = {
    // Optimism mainnet (chainId 10)
    10: "0x75961D2da1DEeBaEC24cD0E180187E6D55F55840",
  };

  const ch6 = isLocal ? (await get("Challenge6")).address : CH6_ADDRS[chainId];

  if (!ch6) {
    throw new Error(`Challenge6 address not configured for chainId ${chainId} (${hre.network.name}).`);
  }

  await deploy("Challenge6Solution", {
    from: deployer,
    args: [ch6],
    log: true,
    autoMine: true,
  });

  console.log("🚩 Challenge 6 Solution contract deployed");
};

export default func;
func.tags = ["solution6"];
func.dependencies = ["Challenge6"]; // ensure local Challenge3 is deployed first

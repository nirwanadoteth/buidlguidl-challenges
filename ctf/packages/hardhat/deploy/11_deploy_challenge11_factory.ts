import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("Challenge11Factory", {
    from: deployer,
    log: true,
    autoMine: true,
  });

  console.log("🚩 Challenge 11 Factory contract deployed");
};

export default func;
func.tags = ["solution11"];

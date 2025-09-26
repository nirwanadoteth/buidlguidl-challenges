import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat/";
import { DiceGame, RiggedRoll } from "../typechain-types";

const deployRiggedRoll: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const diceGame: DiceGame = await ethers.getContract("DiceGame");
  const diceGameAddress = await diceGame.getAddress();

  // Deploy RiggedRoll contract
  await deploy("RiggedRoll", {
    from: deployer,
    log: true,
    args: [diceGameAddress],
    autoMine: true,
  });

  const riggedRoll: RiggedRoll = await ethers.getContract("RiggedRoll", deployer);

  // Please replace the text "Your Address" with your own address.
  // Or set an environment variable RIGGED_ROLL_OWNER to avoid hardcoding it here.
  try {
    const owner = process.env.RIGGED_ROLL_OWNER ?? "Your Address";
    if (owner && owner !== "Your Address") {
      await riggedRoll.transferOwnership(owner);
      console.log(`Transferred RiggedRoll ownership to ${owner}`);
    } else {
      console.log(
        "Skipping ownership transfer: set RIGGED_ROLL_OWNER in .env or replace 'Your Address' with your frontend EOA",
      );
    }
  } catch (err) {
    console.log(err);
  }
};

export default deployRiggedRoll;

deployRiggedRoll.tags = ["RiggedRoll"];

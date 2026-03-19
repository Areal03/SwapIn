import { expect } from "chai";
import hre from "hardhat";

describe("HederaIntentVault", function () {
  it("accepts deposits and allows agent withdrawal and refund", async function () {
    const { ethers } = await hre.network.connect();
    const [owner, agent, user] = await ethers.getSigners();

    const Vault = await ethers.getContractFactory("HederaIntentVault");
    const vault = await Vault.connect(owner).deploy(agent.address);
    await vault.waitForDeployment();

    const depositTx = await user.sendTransaction({
      to: await vault.getAddress(),
      value: ethers.parseEther("1"),
    });
    await expect(depositTx).to.emit(vault, "DepositReceived").withArgs(user.address, ethers.parseEther("1"));

    const orderId = ethers.keccak256(ethers.toUtf8Bytes("swap_order_test_1"));
    await expect(
      vault.connect(agent).registerOrder(orderId, user.address, ethers.parseEther("1"), ethers.ZeroAddress, 0)
    )
      .to.emit(vault, "OrderRegistered")
      .withArgs(orderId, user.address, ethers.parseEther("1"), ethers.ZeroAddress, 0);

    await expect(vault.connect(agent).withdrawForExecution(orderId, agent.address, ethers.parseEther("0.4")))
      .to.emit(vault, "FundsWithdrawn")
      .withArgs(orderId, agent.address, ethers.parseEther("0.4"));

    await expect(vault.connect(agent).refundRemaining(orderId)).to.emit(vault, "OrderRefunded");
  });
});

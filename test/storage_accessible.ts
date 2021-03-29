import { expect } from "chai";
import { BigNumber, BigNumberish, ContractFactory } from "ethers";
import { ethers } from "hardhat";

describe("StorageAccessible", () => {
  const fromHex = (data: string, start?: number, end?: number) =>
    BigNumber.from(ethers.utils.hexDataSlice(data, start || 0, end));
  const keccak = (numbers: BigNumberish[]) =>
    ethers.utils.solidityKeccak256(
      numbers.map(() => "uint256"),
      numbers,
    );

  let StorageAccessibleWrapper: ContractFactory;
  let ExternalStorageReader: ContractFactory;

  before(async () => {
    StorageAccessibleWrapper = await ethers.getContractFactory("StorageAccessibleWrapper");
    ExternalStorageReader = await ethers.getContractFactory("ExternalStorageReader");
  });

  describe("getStorageAt", async () => {
    it("can read statically sized words", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      expect(await instance.getStorageAt(await instance.SLOT_FOO(), 1)).to.equal(
        ethers.utils.solidityPack(["uint256"], [42]),
      );
    });
    it("can read fields that are packed into single storage slot", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setBar(7);
      await instance.setBam(13);

      const data = await instance.getStorageAt(await instance.SLOT_BAR(), 1);
      expect(data).to.equal(
        ethers.utils.hexZeroPad(ethers.utils.solidityPack(["uint64", "uint128"], [13, 7]), 32),
      );
    });
    it("can read arrays in one go", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      const slot = await instance.SLOT_BAZ();
      await instance.setBaz([42, 1337]);

      const length = await instance.getStorageAt(slot, 1);
      expect(BigNumber.from(length)).to.equal(2);

      const data = await instance.getStorageAt(keccak([slot]), length);
      expect(fromHex(data, 0, 32)).to.equal(42);
      expect(fromHex(data, 32, 64)).to.equal(1337);
    });
    it("can read mappings", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setQuxKeyValue(42, 69);
      expect(
        fromHex(await instance.getStorageAt(keccak([42, await instance.SLOT_QUX()]), 1)),
      ).to.equal(69);
    });

    it("can read structs", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoobar(19, 21);

      const packed = await instance.getStorageAt(await instance.SLOT_FOOBAR(), 10);
      expect(fromHex(packed, 0, 32)).to.equal(19);
      expect(fromHex(packed, 32, 64)).to.equal(21);
    });
  });

  describe("simulateDelegatecall", async () => {
    it("can invoke a function in the context of a previously deployed contract", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      // Deploy and use reader contract to access foo
      const reader = await ExternalStorageReader.deploy();
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      const result = await instance.callStatic.simulateDelegatecall(reader.address, getFooCall);
      expect(fromHex(result)).to.equal(42);
    });

    it("can simulate a function with side effects (without executing)", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      // Deploy and use reader contract to simulate setting foo
      const reader = await ExternalStorageReader.deploy();
      const replaceFooCall = reader.interface.encodeFunctionData("setAndGetFoo", [69]);
      let result = await instance.callStatic.simulateDelegatecall(reader.address, replaceFooCall);
      expect(fromHex(result)).to.equal(69);

      // Make sure foo is not actually changed
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      result = await instance.callStatic.simulateDelegatecall(reader.address, getFooCall);
      expect(fromHex(result)).to.equal(42);
    });

    it("can simulate a function that reverts", async () => {
      const instance = await StorageAccessibleWrapper.deploy();

      const reader = await ExternalStorageReader.deploy();
      const doRevertCall = reader.interface.encodeFunctionData("doRevert");
      await expect(instance.callStatic.simulateDelegatecall(reader.address, doRevertCall)).to.be
        .reverted;
    });

    it("allows detection of reverts when invoked from other smart contract", async () => {
      const instance = await StorageAccessibleWrapper.deploy();

      const reader = await ExternalStorageReader.deploy();
      await expect(reader.invokeDoRevertViaStorageAccessible(instance.address)).to.be.reverted;
    });
  });

  describe("simulateStaticDelegatecall", () => {
    it("can be called from a static context", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      const reader = await ExternalStorageReader.deploy();
      const getFooCall = reader.interface.encodeFunctionData("getFoo");
      // invokeStaticDelegatecall is marked as view
      const result = await reader.invokeStaticDelegatecall(instance.address, getFooCall);
      expect(result).to.equal(42);
    });

    it("cannot simulate state changes", async () => {
      const instance = await StorageAccessibleWrapper.deploy();
      await instance.setFoo(42);

      const reader = await ExternalStorageReader.deploy();
      const replaceFooCall = reader.interface.encodeFunctionData("setAndGetFoo", [69]);
      await expect(reader.invokeStaticDelegatecall(reader.address, replaceFooCall)).to.be.reverted;
    });
  });
});

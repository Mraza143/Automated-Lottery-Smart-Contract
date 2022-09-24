const { assert, expect } = require("chai")
const { network, deployments, ethers ,getNamedAccounts } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          let lottery, deployer,lotteryContract, vrfCoordinatorV2Mock, lotteryEntranceFee, interval, player // , deployer

          beforeEach(async () => {
              accounts = await ethers.getSigners() 
                 //deployer = accounts[0]
                 deployer  = (await getNamedAccounts()).deployer
              player = accounts[1]
              await deployments.fixture(["mocks", "lottery"]) // Deploys modules with the tags "mocks" and "lottery"
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock") // Returns a new connection to the VRFCoordinatorV2Mock contract
              lottery = await ethers.getContract("Lottery",deployer) // Returns a new connection to the Lottery contract
              //lottery = lotteryContract.connect(player) // Returns a new instance of the lottery contract connected to player
              lotteryEntranceFee = await lottery.getEntranceFee()
              interval = await lottery.getInterval()
          })

          describe("constructor", function () {
              it("initializes the lottery state correctly", async () => {
                  const lotteryState = (await lottery.getLotteryState()).toString()
                  assert.equal(lotteryState, "0")
                  assert.equal(
                      interval.toString(),
                      networkConfig[network.config.chainId]["keepersUpdateInterval"]
                  )
              })
              it("initializes the lottery interval correctly", async () => {

                assert.equal(
                    interval.toString(),
                    networkConfig[network.config.chainId]["keepersUpdateInterval"]
                )
            })

            it("initializes the mock adress correctly", async () => {
                const response = await lottery.getVrfCoordinator();

                assert.equal(
                    response,
                    vrfCoordinatorV2Mock.address
                )
            })
              
          })
          describe("enterLottery", function () {
            it("reverts when you don't pay enough", async () => {
                await expect(lottery.enterLottery()).to.be.revertedWith( // is reverted when not paid enough or raffle is not open
                    "Lottery__SendMoreToEnterLottery"
                )
            })
            it("records player when they enter", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                const contractPlayer = await lottery.getPlayer(0)
                assert.equal(deployer, contractPlayer)
            })
            it("emits event on enter", async () => {
                await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit( // emits  event if entered to index player(s) address
                lottery,
                    "LotteryEnter"
                )
            })
            it("doesn't allow entrance when lottery is calculating", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                // we pretend to be a keeper for a second
                await lottery.performUpkeep([]) // changes the state to calculating for our comparison below
                await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.be.revertedWith( // is reverted as raffle is calculating
                    "Lottery__LotteryNotOpen"
                )
            })
        })
        describe("checkUpkeep", function () {
            it("returns false if people haven't sent any ETH", async () => {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns false if lottery isn't open", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                await lottery.performUpkeep([]) // changes the state to calculating
                const lotteryState = await lottery.getLotteryState() // stores the new state
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert.equal(lotteryState.toString() == "1", upkeepNeeded == false)
            })
            it("returns false if enough time hasn't passed", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })
        describe("performUpkeep", function () {
            it("can only run if checkupkeep is true", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const tx = await lottery.performUpkeep("0x") 
                assert(tx)
            })
            it("reverts if checkup is false", async () => {
                await expect(lottery.performUpkeep("0x")).to.be.revertedWith( 
                    "Lottery__UpkeepNotNeeded"
                )
            })
            it("updates the lottery state and emits a requestId", async () => {
                // Too many asserts in this test!
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const txResponse = await lottery.performUpkeep("0x") // emits requestId
                const txReceipt = await txResponse.wait(1) // waits 1 block
                const lotteryState = await lottery.getLotteryState() // updates state
                const requestId = txReceipt.events[1].args.requestId
                assert(requestId.toNumber() > 0)
                assert(lotteryState == 1) // 0 = open, 1 = calculating
            })
        })
        describe("fulfillRandomWords", function () {
            beforeEach(async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
            })
            it("can only be called after performupkeep", async () => {
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(0, lottery.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
                await expect(
                    vrfCoordinatorV2Mock.fulfillRandomWords(1, lottery.address) // reverts if not fulfilled
                ).to.be.revertedWith("nonexistent request")
            })

          // This test simulates users entering the raffle and wraps the entire functionality of the raffle
          // inside a promise that will resolve if everything is successful.
          // An event listener for the WinnerPicked is set up
          // Mocks of chainlink keepers and vrf coordinator are used to kickoff this winnerPicked event
          // All the assertions are done once the WinnerPicked event is fired
            it("picks a winner, resets, and sends money", async () => {
                const additionalEntrances = 3 
                const startingIndex = 1
                const accounts = await ethers.getSigners()
                for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) { // i = 2; i < 5; i=i+1
                    //lottery = lotteryContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                    //await lottery.enterLottery({ value: lotteryEntranceFee })
                    const accountConnectedLottery=lottery.connect(accounts[i])
                    await accountConnectedLottery.enterLottery({value:lotteryEntranceFee})
                }
                const startingTimeStamp = await lottery.getLastTimeStamp() // stores starting timestamp (before we fire our event)

                // This will be more important for our staging tests...
                await new Promise(async (resolve, reject) => {
                    lottery.once("WinnerPicked", async () => { // event listener for WinnerPicked
                        console.log("WinnerPicked event fired!")
                        // assert throws an error if it fails, so we need to wrap
                        // it in a try/catch so that the promise returns event
                        // if it fails.
                        try {
                            // Now lets get the ending values...
                            const recentWinner = await lottery.getRecentWinner()
                            console.log(recentWinner)
                            console.log(accounts[0].address)
                            console.log(accounts[1].address)
                            console.log(accounts[2].address)
                            console.log(accounts[3].address)
                            const lotteryState = await lottery.getLotteryState()
                            const winnerBalance = await accounts[1].getBalance()
                            const endingTimeStamp = await lottery.getLastTimeStamp()
                            await expect(lottery.getPlayer(0)).to.be.reverted
                            // Comparisons to check if our ending values are correct:
                            assert.equal(recentWinner.toString(), accounts[1].address)
                            assert.equal(lotteryState, 0)
                            assert.equal(
                                winnerBalance.toString(), 
                                startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                    .add(
                                        lotteryEntranceFee
                                            .mul(additionalEntrances)
                                            .add(lotteryEntranceFee)
                                    )
                                    .toString()
                            )
                            assert(endingTimeStamp > startingTimeStamp)
                            resolve() // if try passes, resolves the promise 
                        } catch (e) { 
                            reject(e) // if try fails, rejects the promise
                        }
                    })

                    // kicking off the event by mocking the chainlink keepers and vrf coordinator
                    const tx = await lottery.performUpkeep("0x")
                    const txReceipt = await tx.wait(1)
                    const startingBalance = await accounts[1].getBalance()
                    await vrfCoordinatorV2Mock.fulfillRandomWords(
                        txReceipt.events[1].args.requestId,
                        lottery.address
                    )
                })
            })
        })

        
              })


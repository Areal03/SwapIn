// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HederaIntentVault {
    address public owner;
    address public agent;

    enum Mode {
        Swap,
        Snipe
    }

    enum Status {
        None,
        Deposited,
        Executing,
        Completed,
        Refunded
    }

    struct Order {
        address userWallet;
        uint256 amount;
        address tokenOut;
        Mode mode;
        Status status;
        uint256 withdrawnAmount;
        uint256 createdAt;
    }

    mapping(bytes32 => Order) public orders;

    event DepositReceived(address indexed payer, uint256 amount);
    event OrderRegistered(bytes32 indexed orderId, address indexed userWallet, uint256 amount, address indexed tokenOut, uint8 mode);
    event FundsWithdrawn(bytes32 indexed orderId, address indexed to, uint256 amount);
    event OrderCompleted(bytes32 indexed orderId);
    event OrderRefunded(bytes32 indexed orderId, address indexed userWallet, uint256 amount);
    event AgentUpdated(address indexed newAgent);
    event OwnershipTransferred(address indexed newOwner);

    error NotOwner();
    error NotAgent();
    error InvalidOrder();
    error InvalidAmount();
    error InvalidStatus();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address initialAgent) {
        owner = msg.sender;
        agent = initialAgent;
    }

    receive() external payable {
        emit DepositReceived(msg.sender, msg.value);
    }

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
        emit OwnershipTransferred(newOwner);
    }

    function registerOrder(
        bytes32 orderId,
        address userWallet,
        uint256 amount,
        address tokenOut,
        uint8 mode
    ) external onlyAgent {
        if (orderId == bytes32(0)) revert InvalidOrder();
        if (userWallet == address(0)) revert InvalidOrder();
        if (amount == 0) revert InvalidAmount();
        if (mode > uint8(Mode.Snipe)) revert InvalidOrder();
        if (orders[orderId].status != Status.None) revert InvalidStatus();

        orders[orderId] = Order({
            userWallet: userWallet,
            amount: amount,
            tokenOut: tokenOut,
            mode: Mode(mode),
            status: Status.Deposited,
            withdrawnAmount: 0,
            createdAt: block.timestamp
        });

        emit OrderRegistered(orderId, userWallet, amount, tokenOut, mode);
    }

    function withdrawForExecution(bytes32 orderId, address payable to, uint256 amount) external onlyAgent {
        Order storage order = orders[orderId];
        if (order.status != Status.Deposited && order.status != Status.Executing) revert InvalidStatus();
        if (amount == 0) revert InvalidAmount();
        if (order.withdrawnAmount + amount > order.amount) revert InvalidAmount();

        order.withdrawnAmount += amount;
        order.status = Status.Executing;

        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FundsWithdrawn(orderId, to, amount);
    }

    function markCompleted(bytes32 orderId) external onlyAgent {
        Order storage order = orders[orderId];
        if (order.status != Status.Executing) revert InvalidStatus();

        order.status = Status.Completed;
        emit OrderCompleted(orderId);
    }

    function refundRemaining(bytes32 orderId) external onlyAgent {
        Order storage order = orders[orderId];
        if (order.status != Status.Deposited && order.status != Status.Executing) revert InvalidStatus();

        uint256 remaining = order.amount - order.withdrawnAmount;
        if (remaining == 0) revert InvalidAmount();

        order.status = Status.Refunded;

        (bool ok, ) = payable(order.userWallet).call{value: remaining}("");
        if (!ok) revert TransferFailed();

        emit OrderRefunded(orderId, order.userWallet, remaining);
    }

    function markRefunded(bytes32 orderId) external onlyAgent {
        Order storage order = orders[orderId];
        if (order.status != Status.Deposited && order.status != Status.Executing) revert InvalidStatus();
        order.status = Status.Refunded;
        emit OrderRefunded(orderId, order.userWallet, 0);
    }
}

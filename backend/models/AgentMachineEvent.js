const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const AgentMachineEvent = sequelize.define('AgentMachineEvent', {
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agentMachineId: { type: DataTypes.INTEGER, allowNull: false },
  fromState:      { type: DataTypes.STRING, allowNull: true },
  toState:        { type: DataTypes.STRING, allowNull: false },
  detail:         { type: DataTypes.STRING, allowNull: true },
})

module.exports = AgentMachineEvent

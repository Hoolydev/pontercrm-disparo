import { relations } from "drizzle-orm";
import { agentAttachments } from "./agent-attachments.js";
import { agents } from "./agents.js";
import { appointments } from "./appointments.js";
import { brokerQueue } from "./broker-queue.js";
import { brokers } from "./brokers.js";
import { campaignAttachments } from "./campaign-attachments.js";
import { campaignInstances } from "./campaign-instances.js";
import { campaignLeads } from "./campaign-leads.js";
import { campaigns } from "./campaigns.js";
import { conversationMemory } from "./conversation-memory.js";
import { conversations } from "./conversations.js";
import { handoffTriggers } from "./handoff-triggers.js";
import { leadFollowups } from "./lead-followups.js";
import { leadScoreEvents } from "./lead-score-events.js";
import { leadScores } from "./lead-scores.js";
import { leadStageAlerts } from "./lead-stage-alerts.js";
import { leadSources } from "./lead-sources.js";
import { leads } from "./leads.js";
import { messages } from "./messages.js";
import { notifications } from "./notifications.js";
import { pipelineStages } from "./pipeline-stages.js";
import { pipelines } from "./pipelines.js";
import { properties } from "./properties.js";
import { toolExecutions } from "./tool-executions.js";
import { users } from "./users.js";
import { whatsappInstances } from "./whatsapp-instances.js";

export const usersRelations = relations(users, ({ one, many }) => ({
  broker: one(brokers, { fields: [users.id], references: [brokers.userId] }),
  campaigns: many(campaigns),
  notifications: many(notifications)
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] })
}));

export const propertiesRelations = relations(properties, ({ one }) => ({
  createdByUser: one(users, {
    fields: [properties.createdBy],
    references: [users.id]
  })
}));

export const brokersRelations = relations(brokers, ({ one, many }) => ({
  user: one(users, { fields: [brokers.userId], references: [users.id] }),
  leads: many(leads),
  conversations: many(conversations),
  appointments: many(appointments)
}));

export const leadSourcesRelations = relations(leadSources, ({ many }) => ({
  leads: many(leads)
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  assignedBroker: one(brokers, {
    fields: [leads.assignedBrokerId],
    references: [brokers.id]
  }),
  pipelineStage: one(pipelineStages, {
    fields: [leads.pipelineStageId],
    references: [pipelineStages.id]
  }),
  score: one(leadScores, {
    fields: [leads.id],
    references: [leadScores.leadId]
  }),
  conversations: many(conversations),
  campaignLeads: many(campaignLeads),
  appointments: many(appointments),
  followups: many(leadFollowups),
  brokerQueue: many(brokerQueue),
  scoreEvents: many(leadScoreEvents)
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  lead: one(leads, { fields: [conversations.leadId], references: [leads.id] }),
  campaign: one(campaigns, {
    fields: [conversations.campaignId],
    references: [campaigns.id]
  }),
  assignedBroker: one(brokers, {
    fields: [conversations.assignedBrokerId],
    references: [brokers.id]
  }),
  agent: one(agents, {
    fields: [conversations.agentId],
    references: [agents.id]
  }),
  whatsappInstance: one(whatsappInstances, {
    fields: [conversations.whatsappInstanceId],
    references: [whatsappInstances.id]
  }),
  messages: many(messages),
  memory: one(conversationMemory, {
    fields: [conversations.id],
    references: [conversationMemory.conversationId]
  }),
  appointments: many(appointments),
  toolExecutions: many(toolExecutions)
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id]
  }),
  instance: one(whatsappInstances, {
    fields: [messages.instanceId],
    references: [whatsappInstances.id]
  }),
  toolExecutions: many(toolExecutions)
}));

export const conversationMemoryRelations = relations(conversationMemory, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMemory.conversationId],
    references: [conversations.id]
  })
}));

export const agentsRelations = relations(agents, ({ many }) => ({
  conversations: many(conversations),
  triggers: many(handoffTriggers),
  campaignsAsOutbound: many(campaigns, { relationName: "outboundAgent" }),
  campaignsAsInbound: many(campaigns, { relationName: "inboundAgent" }),
  attachments: many(agentAttachments)
}));

export const agentAttachmentsRelations = relations(agentAttachments, ({ one }) => ({
  agent: one(agents, { fields: [agentAttachments.agentId], references: [agents.id] })
}));

export const handoffTriggersRelations = relations(handoffTriggers, ({ one }) => ({
  agent: one(agents, {
    fields: [handoffTriggers.agentId],
    references: [agents.id]
  })
}));

export const whatsappInstancesRelations = relations(whatsappInstances, ({ many }) => ({
  conversations: many(conversations),
  messages: many(messages),
  campaignInstances: many(campaignInstances)
}));

// ── Pipelines ────────────────────────────────────────────────────────────────
export const pipelinesRelations = relations(pipelines, ({ many }) => ({
  stages: many(pipelineStages),
  campaigns: many(campaigns)
}));

export const pipelineStagesRelations = relations(pipelineStages, ({ one, many }) => ({
  pipeline: one(pipelines, {
    fields: [pipelineStages.pipelineId],
    references: [pipelines.id]
  }),
  leads: many(leads)
}));

// ── Campaigns ────────────────────────────────────────────────────────────────
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  outboundAgent: one(agents, {
    fields: [campaigns.outboundAgentId],
    references: [agents.id],
    relationName: "outboundAgent"
  }),
  inboundAgent: one(agents, {
    fields: [campaigns.inboundAgentId],
    references: [agents.id],
    relationName: "inboundAgent"
  }),
  pipeline: one(pipelines, {
    fields: [campaigns.pipelineId],
    references: [pipelines.id]
  }),
  createdByUser: one(users, {
    fields: [campaigns.createdBy],
    references: [users.id]
  }),
  instances: many(campaignInstances),
  campaignLeads: many(campaignLeads),
  conversations: many(conversations),
  attachments: many(campaignAttachments)
}));

export const campaignAttachmentsRelations = relations(campaignAttachments, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignAttachments.campaignId], references: [campaigns.id] })
}));

export const campaignInstancesRelations = relations(campaignInstances, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignInstances.campaignId],
    references: [campaigns.id]
  }),
  instance: one(whatsappInstances, {
    fields: [campaignInstances.instanceId],
    references: [whatsappInstances.id]
  })
}));

export const campaignLeadsRelations = relations(campaignLeads, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignLeads.campaignId],
    references: [campaigns.id]
  }),
  lead: one(leads, {
    fields: [campaignLeads.leadId],
    references: [leads.id]
  })
}));

// ── Appointments / Tool executions ───────────────────────────────────────────
export const appointmentsRelations = relations(appointments, ({ one }) => ({
  conversation: one(conversations, {
    fields: [appointments.conversationId],
    references: [conversations.id]
  }),
  lead: one(leads, {
    fields: [appointments.leadId],
    references: [leads.id]
  }),
  broker: one(brokers, {
    fields: [appointments.brokerId],
    references: [brokers.id]
  })
}));

export const toolExecutionsRelations = relations(toolExecutions, ({ one }) => ({
  conversation: one(conversations, {
    fields: [toolExecutions.conversationId],
    references: [conversations.id]
  }),
  message: one(messages, {
    fields: [toolExecutions.messageId],
    references: [messages.id]
  })
}));

export const leadStageAlertsRelations = relations(leadStageAlerts, ({ one }) => ({
  lead: one(leads, { fields: [leadStageAlerts.leadId], references: [leads.id] }),
  stage: one(pipelineStages, {
    fields: [leadStageAlerts.stageId],
    references: [pipelineStages.id]
  })
}));

// ── Followups / queue / scoring ──────────────────────────────────────────
export const leadFollowupsRelations = relations(leadFollowups, ({ one }) => ({
  lead: one(leads, { fields: [leadFollowups.leadId], references: [leads.id] }),
  conversation: one(conversations, {
    fields: [leadFollowups.conversationId],
    references: [conversations.id]
  }),
  campaign: one(campaigns, {
    fields: [leadFollowups.campaignId],
    references: [campaigns.id]
  }),
  broker: one(brokers, { fields: [leadFollowups.brokerId], references: [brokers.id] })
}));

export const brokerQueueRelations = relations(brokerQueue, ({ one }) => ({
  lead: one(leads, { fields: [brokerQueue.leadId], references: [leads.id] }),
  broker: one(brokers, { fields: [brokerQueue.brokerId], references: [brokers.id] }),
  conversation: one(conversations, {
    fields: [brokerQueue.conversationId],
    references: [conversations.id]
  })
}));

export const leadScoresRelations = relations(leadScores, ({ one, many }) => ({
  lead: one(leads, { fields: [leadScores.leadId], references: [leads.id] }),
  events: many(leadScoreEvents)
}));

export const leadScoreEventsRelations = relations(leadScoreEvents, ({ one }) => ({
  lead: one(leads, { fields: [leadScoreEvents.leadId], references: [leads.id] })
}));

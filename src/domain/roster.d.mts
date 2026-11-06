/* Copyright (c) 2026 jiongjiong123441. All rights reserved.
 * Licensed under PolyForm Noncommercial 1.0.0.
 * Noncommercial use, modification, and distribution are permitted.
 * Keep this notice and the LICENSE file with all copies and modified versions. */

export interface RosterEmployee {id:string;name:string;dailyHours:number|null;enabled:boolean;preferredStart:string;preferredEnd:string;unavailableDates:string[];weekdays?:number[];weeklyHours?:number;maxDays?:number;lastSelfPreferenceChange?:string|null;preferenceUpdatedBy?:string;preferenceUpdatedAt?:string}
export interface RosterShift {id:string;employeeId:string;day:string;start:string;end:string;service?:boolean;locked?:boolean}
export interface RosterTask {id:string;orderId:string;orderNo:string;deviceName:string;customer:string;kind:'pickup'|'return';day:string;start:string;end:string;employeeId?:string|null;assignmentReason?:string;service?:boolean;received?:boolean;collection?:boolean;ambiguous?:boolean}
export interface RosterGrant {id:string;employeeId:string;day:string;start:string;end:string;scope:'task';taskId:string;reason:string;status:'PENDING'|'APPROVED'|'REJECTED'|'REVOKED';requestedAt:string;reviewedBy?:string;reviewedAt?:string;reviewReason?:string}
export interface RosterSettings {dailyHours:number;maxDays:number;maxConsecutive:number;minStaff:number}
export type RosterBusiness=import('./pickupTimeSlots').PickupTimeSettings;
export type RosterWarning={day:string;start:string;end:string;message:string};
export function rosterMinutes(time:string):number;
export function rosterTime(minutes:number):string;
export function rosterAddDays(day:string,amount:number):string;
export function rosterDays(start:string):string[];
export function rosterOpenWindows(day:string,business:RosterBusiness):{start:number;end:number}[];
export function rosterServiceWindows(day:string,business:RosterBusiness):{start:number;end:number}[];
export function rosterTaskMode(task:RosterTask,business:RosterBusiness):'business'|'service'|null;
export function rosterCoverageWindows(day:string,tasks:RosterTask[],business:RosterBusiness):{start:number;end:number;service:boolean}[];
export function rosterShiftMinutes(shift:RosterShift):number;
export function rosterValidateShift(shift:RosterShift,business:RosterBusiness,tasks?:RosterTask[]):string;
export function generateRoster(input:RosterSettings & {start:string;employees:RosterEmployee[];tasks:RosterTask[];business:RosterBusiness;locked?:RosterShift[];history?:RosterShift[]}):{shifts:RosterShift[];warnings:RosterWarning[]};
export function assignRosterTasks(tasks:RosterTask[],shifts:RosterShift[],business:RosterBusiness,overrides?:Record<string,string>):RosterTask[];
export function rosterCanOperate(input:{employeeId:string;task?:RosterTask;shifts:RosterShift[];grants:RosterGrant[];business:RosterBusiness;now?:string;role?:string}):{allowed:boolean;reason?:string;via?:string;grantId?:string};
export function rosterPreferencePermission(employee:RosterEmployee,input?:{role?:string;actorId?:string;now?:string;policy?:string}):{allowed:boolean;nextAllowedAt:string|null;reason?:string};
export function rosterPublishEmployees(current:RosterEmployee[],proposed:RosterEmployee[],baseline?:RosterEmployee[]):RosterEmployee[];

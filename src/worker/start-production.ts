import {assertStagingDestination} from '../lib/telegram/staging-guard';
import {startProductionRoles} from './production-roles';
assertStagingDestination(process.env);
startProductionRoles();

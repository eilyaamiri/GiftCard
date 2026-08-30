import { Body, Controller, Get, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { requireStaff } from './staff-context';
import {
  completeWorkItemBodySchema,
  failWorkItemBodySchema,
  listWorkItemsQuerySchema,
  type CompleteWorkItemBody,
  type FailWorkItemBody,
  type ListWorkItemsQuery,
} from './workitems.schemas';
import { WorkItemsService } from './workitems.service';
import type { WorkItemSummary } from './workitems.types';

@Controller('operator/work-items')
export class WorkItemsController {
  constructor(@Inject(WorkItemsService) private readonly workItems: WorkItemsService) {}

  @Get()
  async list(
    @Query(zodPipe(listWorkItemsQuerySchema)) query: ListWorkItemsQuery,
    @Req() request: unknown,
  ): Promise<{ items: readonly WorkItemSummary[] }> {
    requireStaff(request);
    const items = await this.workItems.list(query);
    return { items };
  }

  @Get('mine')
  async mine(@Req() request: unknown): Promise<{ items: readonly WorkItemSummary[]; capacityUsed: number }> {
    const staff = requireStaff(request);
    const items = await this.workItems.list({ assignedToStaffId: staff.id });
    const capacityUsed = await this.workItems.activeCountFor(staff.id);
    return { items, capacityUsed };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() request: unknown): Promise<{ item: WorkItemSummary }> {
    requireStaff(request);
    return { item: await this.workItems.getById(id) };
  }

  /**
   * Claiming is a POST because it mutates ownership. Two operators pressing the
   * button in the same millisecond is the normal case, not an edge case: one
   * receives 200 and one receives 409.
   */
  @Post(':id/claim')
  async claim(@Param('id') id: string, @Req() request: unknown): Promise<{ item: WorkItemSummary }> {
    const staff = requireStaff(request);
    return { item: await this.workItems.claim(id, staff.id) };
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @Req() request: unknown): Promise<{ item: WorkItemSummary }> {
    const staff = requireStaff(request);
    return { item: await this.workItems.start(id, staff.id) };
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @Body(zodPipe(completeWorkItemBodySchema)) body: CompleteWorkItemBody,
    @Req() request: unknown,
  ): Promise<{ item: WorkItemSummary }> {
    const staff = requireStaff(request);
    return { item: await this.workItems.complete(id, staff.id, body.resolutionNote) };
  }

  @Post(':id/fail')
  async fail(
    @Param('id') id: string,
    @Body(zodPipe(failWorkItemBodySchema)) body: FailWorkItemBody,
    @Req() request: unknown,
  ): Promise<{ item: WorkItemSummary }> {
    const staff = requireStaff(request);
    return { item: await this.workItems.fail(id, staff.id, body.resolutionNote) };
  }
}

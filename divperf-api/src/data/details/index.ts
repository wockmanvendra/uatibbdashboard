/** Every detail list, by its id in GET /api/details/:list. */
import type { DetailListId } from '../../types/api.js';
import type { DetailListDef } from './types.js';
import { doctorsList } from './doctors.js';
import { joinersList, leaversList } from './people.js';
import { tmEffortList } from './tmEffort.js';
import { hqHeadcountList } from './hqHeadcount.js';
import { hospitalsList } from './hospitals.js';

export const DETAIL_LISTS: Record<DetailListId, DetailListDef> = {
  doctors: doctorsList,
  leavers: leaversList,
  joiners: joinersList,
  'tm-effort': tmEffortList,
  'hq-headcount': hqHeadcountList,
  hospitals: hospitalsList,
};

export const isDetailListId = (id: string): id is DetailListId => id in DETAIL_LISTS;

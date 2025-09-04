import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  ViewChild,
  Output,
  OnInit,
  ViewContainerRef
} from '@angular/core';
import {DateRange} from '../../../model/date-range';
import {Worklog} from '../../../model/worklog';
import {Format} from '../../../helpers/format';
import {AuthFacade} from '../../../core/auth/auth.facade';
import {AppStateService} from '../../../core/app-state.service';
import {WorklogFacade} from '../../../core/worklog/worklog.facade';
import {DatePickerCloudComponent} from './date-picker-cloud/date-picker-cloud.component';
import {Issue} from '../../../model/issue';
import {IssuePickerCloudComponent} from './issue-picker-cloud/issue-picker-cloud.component';
import {Subject} from 'rxjs';
import {IssueApi} from '../../../core/issue/issue.api';
import {WorklogApi} from '../../../core/worklog/worklog.api';

/**
 * Smart component, presenting edited worklog, handling all its interactions and updating worklog on the server
 */
@Component({
  selector: 'plaid-worklog-editor',
  templateUrl: './worklog-editor.component.html',
  styleUrls: ['./worklog-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class WorklogEditorComponent implements OnInit {
  static readonly GRID_OFFSET_TOP = 62; // top bar height + grid header height
  static readonly GRID_OFFSET_LEFT = 30; // hour labels width
  static readonly STRETCH_HANDLE_OFFSET_TOP = 4; // offset between top of a stretching handle and edge of the panel

  _pixelsPerMinute: number;
  _dateRange: DateRange;
  _worklog: Worklog | null;
  start: Date;
  date: Date;
  durationMinutes: number;
  panelOffsetTop: number;
  panelHeight: number;
  panelOffsetLeft: number;
  panelWidth: number;
  spaceUnderPanel: number;
  editedPanelInRange: boolean;
  panelHue: number;
  panelSaturation: number;
  dragging = false;
  stretching = false;
  mouseEventXOffset: number;
  mouseEventYOffset: number;
  issueString: string;
  dateString: string;
  commentString: string;
  startTimeString: string;
  endTimeString: string;
  saving = false;
  calendarOpen = false;
  calendarOffsetTop = 0;
  flipCalendar = false;
  issuePickerOpen = false;
  issuePickerOffsetTop = 0;
  _visibleDaysStart: number;
  _visibleDaysEnd: number;
  updateFavoriteIssuesAndSuggestionsAndEmitSuggestion = new Subject<void>();
  adding: boolean;
  /** Indica si la tarea seleccionada no tiene estimación */
  missingEstimate = false;
  /** Texto de advertencia a mostrar junto al icono */
  warningMessage: string = '';
  /** Texto para que el usuario ingrese la nueva estimación original */
  originalEstimateText: string = '';
  /** Usuario seleccionado para filtrar tareas (username) */
  selectedOwner: string = '';
  /** Display name del usuario seleccionado */
  selectedOwnerDisplay: string = '';
  /** Objeto User completo del usuario seleccionado */
  selectedUserObject: any = null;
  /** Estado del user picker */
  userPickerOpen = false;
  userPickerOffsetTop = 0;

  @ViewChild('panel')
  panel: ElementRef<HTMLDivElement>;

  @ViewChild('wrapper')
  wrapper: ElementRef<HTMLDivElement>;

  @ViewChild('calendarToggle')
  calendarToggle: ElementRef<HTMLInputElement>;

  @ViewChild(DatePickerCloudComponent, {read: ViewContainerRef})
  calendarCloud: ViewContainerRef;

  @ViewChild('issuePickerToggle')
  issuePickerToggle: ElementRef<HTMLInputElement>;

  @ViewChild('commentTextArea')
  commentTextArea: ElementRef<HTMLTextAreaElement>;

  @ViewChild('cancelButton')
  cancelButton: ElementRef<HTMLButtonElement>;

  @ViewChild(IssuePickerCloudComponent, {read: ViewContainerRef})
  issuePickerCloud: ViewContainerRef;

  @Output()
  cancelEdit = new EventEmitter<void>();

  @Input()
  gridElement: HTMLDivElement;

  /**
   * Whether keyboard navigation should be disabled due to modal or a cloud being open.
   */
  @Input()
  keysDisabled: boolean;

  /**
   * In how many vertical pixels is one minute represented
   */
  @Input()
  set pixelsPerMinute(value: number) {
    if (this.mouseEventYOffset != null) {
      this.mouseEventYOffset *= value / this._pixelsPerMinute;
    }
    this._pixelsPerMinute = value;
    if (this.worklog && this.editedPanelInRange) {
      this.computeSizeAndOffset();
    }
  }
  get pixelsPerMinute(): number {
    return this._pixelsPerMinute;
  }

  /**
   * Visible date range
   */
  @Input()
  set dateRange(range: DateRange) {
    this._dateRange = range;
    if (this.worklog) {
      this.editedPanelInRange = this.date >= range.start && this.date <= range.end;
      if (this.editedPanelInRange) {
        this.computeSizeAndOffset();
      }
    }
  }
  get dateRange(): DateRange {
    return this._dateRange;
  }

  /**
   * Currently edited worklog
   */
  @Input()
  set worklog(worklog: Worklog | null) {
    // Inicializar warning
    this.missingEstimate = false;
    this.warningMessage = '';
    if (worklog) {
      this._worklog = {...worklog};
      this.saving = false;
      this.adding = !worklog.id;
      this.start = new Date(worklog.started ?? Date.now());
      this.start.setSeconds(0, 0);
      this.date = new Date(this.start);
      this.date.setHours(0, 0, 0, 0);
      this.durationMinutes = Math.round((worklog.timeSpentSeconds ?? 0) / 60);
      const end = new Date(this.start);
      end.setMinutes(this.start.getMinutes() + this.durationMinutes);
      this.startTimeString = Format.time(this.start);
      this.endTimeString = Format.time(end);
      this.editedPanelInRange = this.date >= this.dateRange.start && this.date <= this.dateRange.end;
      this.updatePanelHueSaturationAndIssueString(worklog.issue);
      this.dateString = Format.date(this.start);
      this.commentString = this.worklogApi.extractTextFromAdf(worklog.comment ?? '**Avances del dia de hoy**\n\n\n**En que punto estamos**\n\n');
      if (this.editedPanelInRange) {
        this.computeSizeAndOffset();
      }
      if (this.adding) {
        // Clear user selection for new worklogs
        this.selectedOwner = '';
        this.selectedOwnerDisplay = '';
        this.selectedUserObject = null;
        this.updateFavoriteIssuesAndSuggestionsAndEmitSuggestion.next();
      }
      // Al cargar editor, obtener issue completo para validar estimación
      const key = this._worklog.issue?.key;
      if (key) {
        this.issueApi.getIssue$(key).subscribe(full => {
          if (full) {
            this._worklog!.issue = full;
            const estimate = full.fields?.timeoriginalestimate ?? 0;
            if (estimate <= 0) {
              this.missingEstimate = true;
              this.warningMessage = 'No original estimate set';
            }
            this.cdr.detectChanges();
          }
        });
      }
      addEventListener('keydown', this.onKeydown);
    } else {
      this._worklog = null;
      removeEventListener('keydown', this.onKeydown);
    }
  }
  get worklog(): Worklog | null {
    return this._worklog;
  }

  /**
   * Beginning of the range for week days displayed on the calendar. Editing work logs on days outside working week is
   * prohibited.
   */
  @Input()
  set visibleDaysStart(value: number) {
    this._visibleDaysStart = value;
    if (this.date && !this.isDateVisible(this.date)) {
      this.close();
    }
  }
  get visibleDaysStart(): number {
    return this._visibleDaysStart;
  }

  /**
   * End of the range for week days displayed on the calendar. Editing work logs on days outside working week is
   * prohibited.
   */
  @Input()
  set visibleDaysEnd(value: number) {
    this._visibleDaysEnd = value;
    if (this.date && !this.isDateVisible(this.date)) {
      this.close();
    }
  }
  get visibleDaysEnd(): number {
    return this._visibleDaysEnd;
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private authFacade: AuthFacade,
    private worklogFacade: WorklogFacade,
    private appStateService: AppStateService,
    private issueApi: IssueApi,
    private worklogApi: WorklogApi
  ) {
  }

  /**
   * When user changes authentication data, the editor should close.
   */
  ngOnInit(): void {
    // Singleton component, no need to unsubscribe
    this.authFacade.getAuthenticatedUser$().subscribe(() => this.close());
  }

  /**
   * Handles keyboard navigation in the editor. Pressing space when focused on date or issue field opens respective
   * cloud, pressing escape closes a cloud or the editor and pressing Enter submits the entry.
   */
  onKeydown: (event: KeyboardEvent) => void = (event: KeyboardEvent) => {
    if (!this.keysDisabled) {
      switch (event.key) {
        case 'Escape':
          if (this.calendarOpen) {
            this.toggleCalendar();
            this.calendarToggle.nativeElement.focus();
          } else if (this.issuePickerOpen) {
            this.toggleIssuePicker();
            this.issuePickerToggle.nativeElement.focus();
          } else {
            this.close();
          }
          break;
        case ' ':
          if (document.activeElement === this.calendarToggle.nativeElement) {
            this.toggleCalendar();
            event.preventDefault();
          } else if (document.activeElement === this.issuePickerToggle.nativeElement) {
            this.toggleIssuePicker();
            event.preventDefault();
          }
          break;
        case 'Enter':
          if (!this.calendarOpen && !this.issuePickerOpen && document.activeElement !== this.cancelButton.nativeElement
            && !(document.activeElement === this.commentTextArea.nativeElement && !event.ctrlKey)) {
            this.save();
          }
          break;
      }
      this.cdr.detectChanges();
    }
  }

  /**
   * Puts the edited panel in the correct offset, gives it correct size and does layout checks according to edited
   * worklog's start time, end time, date, currently visible date range and pixels per minute.
   */
  computeSizeAndOffset(): void {
    this.panelOffsetTop = (this.start.getHours() * 60 + this.start.getMinutes()) * this.pixelsPerMinute;
    this.panelHeight = Math.min(
      this.durationMinutes * this.pixelsPerMinute,
      1440 * this.pixelsPerMinute - this.panelOffsetTop
    );
    this.panelWidth = 1 / (Math.round((this.dateRange.end.getTime() - this.dateRange.start.getTime()) / 86400000) + 1);
    this.panelOffsetLeft = this.panelWidth * Math.round((this.date.getTime() - this.dateRange.start.getTime()) / 86400000);
    this.spaceUnderPanel = 1440 * this.pixelsPerMinute - this.panelOffsetTop - this.panelHeight;
    this.calendarOffsetTop = this.calendarToggle.nativeElement.offsetTop + 31 - this.panel.nativeElement.scrollTop;
    this.flipCalendar = this.panelOffsetTop + this.calendarOffsetTop + 240 > 1440 * this.pixelsPerMinute;
    this.issuePickerOffsetTop = Math.min(
      this.issuePickerToggle.nativeElement.offsetTop - this.panel.nativeElement.scrollTop + 1,
      1440 * this.pixelsPerMinute - this.panelOffsetTop - 400
    );
    
    // Calculate user picker offset (above the issue picker)
    const ownerInput = document.getElementById('owner-input');
    if (ownerInput) {
      this.userPickerOffsetTop = Math.min(
        ownerInput.offsetTop - this.panel.nativeElement.scrollTop + 1,
        1440 * this.pixelsPerMinute - this.panelOffsetTop - 300
      );
    }
  }

  /**
   * Initiates panel dragging, adds event listeners for mouse movement and button release
   */
  dragStart(event: MouseEvent): void {
    if (!this.saving && event.button === 0 && event.target === this.panel.nativeElement) {
      this.dragging = true;
      this.mouseEventXOffset = event.offsetX;
      this.mouseEventYOffset = event.offsetY;
      addEventListener('mousemove', this.handleDragEvent);
      addEventListener('mouseup', () => this.dragEnd(), {once: true});
    }
  }

  dragEnd(): void {
    this.dragging = false;
    this.cdr.detectChanges();
    removeEventListener('mousemove', this.handleDragEvent);
  }

  /**
   * Handles mouse movement during panel dragging calculating change in start time and date
   */
  handleDragEvent: (event: MouseEvent) => void = (event: MouseEvent) => {
    // Handle dragging vertically
    const oldStartTimeMinutes: number = this.start.getHours() * 60 + this.start.getMinutes();
    let newStartTimeMinutes: number = this.getPointerTopOffsetMinutes(event, this.getSnapTo(event));
    if (oldStartTimeMinutes !== newStartTimeMinutes) {
      if (newStartTimeMinutes < 0) { // Prevent dragging above the grid
        newStartTimeMinutes = 0;
      } else if (newStartTimeMinutes + this.durationMinutes > 1440) { // Prevent dragging below the grid
        newStartTimeMinutes = 1440 - this.durationMinutes;
      }
      this.start.setHours(0, newStartTimeMinutes, 0, 0);
      const end = new Date(this.start);
      end.setMinutes(this.start.getMinutes() + this.durationMinutes);
      this.startTimeString = Format.time(this.start);
      this.endTimeString = Format.time(end);
    }

    // Handle dragging horizontally
    const pixelsPerDay: number = (this.gridElement.scrollWidth - WorklogEditorComponent.GRID_OFFSET_LEFT) * this.panelWidth;
    const oldDate: Date = new Date(this.date);
    const newDate: Date = new Date(this.dateRange.start);
    newDate.setDate(newDate.getDate() + Math.round((event.clientX + this.gridElement.scrollLeft -
      WorklogEditorComponent.GRID_OFFSET_LEFT - this.mouseEventXOffset) / pixelsPerDay));
    if (oldDate.getTime() !== newDate.getTime()) {
      if (newDate < this.dateRange.start) { // Prevent dragging to before the visible date range
        this.date = new Date(this.dateRange.start);
      } else if (newDate > this.dateRange.end) { // Prevent dragging to after the visible date range
        this.date = new Date(this.dateRange.end);
      } else {
        this.date = newDate;
      }
      this.start.setFullYear(this.date.getFullYear(), this.date.getMonth(), this.date.getDate());
      this.dateString = Format.date(this.start);
    }

    if (oldStartTimeMinutes !== newStartTimeMinutes || oldDate.getTime() !== newDate.getTime()) {
      this.computeSizeAndOffset();
      this.cdr.detectChanges();
    }
  }

  /**
   * Initiates top stretch handle dragging, adds event listeners for mouse movement and button release
   */
  stretchTopStart(event: MouseEvent): void {
    if (!this.saving && event.button === 0) {
      this.stretching = true;
      this.mouseEventYOffset = event.offsetY - WorklogEditorComponent.STRETCH_HANDLE_OFFSET_TOP;
      addEventListener('mousemove', this.handleStretchTopEvent);
      addEventListener('mouseup', () => this.stretchEnd(this.handleStretchTopEvent), {once: true});
    }
  }

  /**
   * Initiates bottom stretch handle dragging, adds event listeners for mouse movement and button release
   */
  stretchBottomStart(event: MouseEvent): void {
    if (!this.saving && event.button === 0) {
      this.stretching = true;
      this.mouseEventYOffset = event.offsetY - WorklogEditorComponent.STRETCH_HANDLE_OFFSET_TOP;
      addEventListener('mousemove', this.handleStretchBottomEvent);
      addEventListener('mouseup', () => this.stretchEnd(this.handleStretchBottomEvent), {once: true});
    }
  }

  stretchEnd(eventListenerToRemove: (event: MouseEvent) => void): void {
    this.stretching = false;
    this.cdr.detectChanges();
    removeEventListener('mousemove', eventListenerToRemove);
  }

  /**
   * Handles mouse movement during top stretch handle dragging calculating change in start time and work duration
   */
  handleStretchTopEvent: (event: MouseEvent) => void = (event: MouseEvent) => {
    const snapTo: number = this.getSnapTo(event);
    const oldStartTimeMinutes: number = this.start.getHours() * 60 + this.start.getMinutes();
    const endTimeMinutes: number = oldStartTimeMinutes + this.durationMinutes;
    let newStartTimeMinutes: number = this.getPointerTopOffsetMinutes(event, snapTo);
    if (oldStartTimeMinutes !== newStartTimeMinutes) {
      if (newStartTimeMinutes < 0) { // Prevent stretching above the upper bound of the grid
        newStartTimeMinutes = 0;
      } else if (newStartTimeMinutes >= endTimeMinutes) { // Prevent stretching below the lower bound of the work log entry
        newStartTimeMinutes = Math.floor((endTimeMinutes - 1) / snapTo) * snapTo;
      }
      this.start.setHours(0, newStartTimeMinutes, 0, 0);
      this.durationMinutes += oldStartTimeMinutes - newStartTimeMinutes;
      this.startTimeString = Format.time(this.start);

      this.computeSizeAndOffset();
      this.cdr.detectChanges();
    }
  }

  /**
   * Handles mouse movement during top stretch handle dragging calculating change in work duration
   */
  handleStretchBottomEvent: (event: MouseEvent) => void = (event: MouseEvent) => {
    const snapTo: number = this.getSnapTo(event);
    const startTimeMinutes: number = this.start.getHours() * 60 + this.start.getMinutes();
    const oldEndTimeMinutes: number = startTimeMinutes + this.durationMinutes;
    let newEndTimeMinutes: number = this.getPointerTopOffsetMinutes(event, snapTo);
    if (oldEndTimeMinutes !== newEndTimeMinutes) {
      if (newEndTimeMinutes <= startTimeMinutes) { // Prevent stretching above the upper bound of the work log entry
        newEndTimeMinutes = Math.ceil((startTimeMinutes + 1) / snapTo) * snapTo;
      } else if (newEndTimeMinutes > 1440) { // Prevent stretching below the grid
        newEndTimeMinutes = 1440;
      }
      this.durationMinutes = newEndTimeMinutes - startTimeMinutes;
      const end = new Date(this.start);
      end.setMinutes(this.start.getMinutes() + this.durationMinutes);
      this.endTimeString = Format.time(end);

      this.computeSizeAndOffset();
      this.cdr.detectChanges();
    }
  }

  /**
   * Returns what interval of minutes should dragging events snap to according to what modifier keys on keyboard are
   * pressed.
   */
  getSnapTo(event: MouseEvent): number {
    if (event.altKey && !event.ctrlKey && !event.shiftKey) {
      return 1;
    } else if (!event.altKey && event.ctrlKey && !event.shiftKey) {
      return 60;
    } else if (!event.altKey && !event.ctrlKey && event.shiftKey) {
      return 15;
    } else {
      return 5;
    }
  }

  /**
   * Returns number of minutes from start of the day according to what the mouse points at, rounded to snapTo interval
   */
  getPointerTopOffsetMinutes(event: MouseEvent, snapTo: number): number {
    return Math.round(
      (event.clientY + this.gridElement.scrollTop - WorklogEditorComponent.GRID_OFFSET_TOP - this.mouseEventYOffset)
      / this.pixelsPerMinute / snapTo
    ) * snapTo;
  }

  /**
   * Closes the editor if user clicked outside the panel with left mouse button
   */
  handleClickOutsideEditor(event: MouseEvent): void {
  }

  /**
   * Handles owner/assignee input change to filter issues by selected user
   */
  onOwnerChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.selectedOwner = target.value.trim();
    // Trigger refresh of issue picker suggestions when owner changes
    if (this.issuePickerOpen) {
      this.updateFavoriteIssuesAndSuggestionsAndEmitSuggestion.next();
    }
  }

  /**
   * Handles date selection in the calendar cloud, changing worklog date and changing visible date range to include it
   */
  selectDate(date: Date): void {
    this.date = date;
    this.start.setFullYear(this.date.getFullYear(), this.date.getMonth(), this.date.getDate());
    this.dateString = Format.date(this.start);
    this.editedPanelInRange = this.date >= this.dateRange.start && this.date <= this.dateRange.end;
    this.returnToEditedWorklog();
    this.computeSizeAndOffset();
  }

  /**
   * Changes visible date range to include worklog date
   */
  returnToEditedWorklog(): void {
    const start = new Date(this.date);
    start.setDate(start.getDate() - start.getDay() + this.visibleDaysStart);
    const end = new Date(start);
    end.setDate(end.getDate() + this.visibleDaysEnd - this.visibleDaysStart);
    if (start.getTime() !== this.dateRange.start.getTime() || end.getTime() !== this.dateRange.end.getTime()) {
      this.appStateService.setVisibleDateRange({start, end});
    }
  }

  /**
   * Opens or closes calendar cloud and sets event listener to close the calendar if user clicked outside it
   */
  toggleCalendar(): void {
    if (!this.saving && !this.calendarOpen) {
      this.calendarOpen = true;
      this.computeSizeAndOffset();

      const mousedownOutsideCalendarEventListener = (event: MouseEvent) => {
        if (!(this.calendarCloud.element.nativeElement as Node).contains(event.target as Node)
          && event.target !== this.calendarToggle.nativeElement) {
          this.calendarOpen = false;
          removeEventListener('mousedown', mousedownOutsideCalendarEventListener);

          this.cdr.detectChanges();
        }
      };

      addEventListener('mousedown', mousedownOutsideCalendarEventListener);
    } else {
      this.calendarOpen = false;
    }
  }

  /**
   * Opens or closes issue picker cloud and sets event listener to close the calendar if user clicked outside it
   */
  toggleIssuePicker(): void {
    if (!this.saving && !this.issuePickerOpen && this.adding) {
      this.issuePickerOpen = true;
      this.computeSizeAndOffset();

      const mousedownOutsideIssuePickerEventListener = (event: MouseEvent) => {
        if (!(this.issuePickerCloud.element.nativeElement as Node).contains(event.target as Node)
          && event.target !== this.issuePickerToggle.nativeElement) {
          this.issuePickerOpen = false;
          removeEventListener('mousedown', mousedownOutsideIssuePickerEventListener);

          this.cdr.detectChanges();
        }
      };

      addEventListener('mousedown', mousedownOutsideIssuePickerEventListener);
    } else {
      this.issuePickerOpen = false;
    }
  }

  /**
   * Opens or closes user picker cloud
   */
  toggleUserPicker(event?: MouseEvent): void {
    // If click originated on the clear button, do not open the picker
    if (event && (event.target as HTMLElement).closest && (event.target as HTMLElement).closest('.clear-user-button')) {
      return;
    }
    if (!this.saving && !this.userPickerOpen) {
      this.userPickerOpen = true;
      this.computeSizeAndOffset();

      const mousedownOutsideUserPickerEventListener = (event: MouseEvent) => {
        const userPickerElement = document.querySelector('plaid-user-picker-cloud');
        if (userPickerElement && !(userPickerElement as Node).contains(event.target as Node)
          && event.target !== document.getElementById('owner-input')) {
          this.userPickerOpen = false;
          removeEventListener('mousedown', mousedownOutsideUserPickerEventListener);

          this.cdr.detectChanges();
        }
      };

  addEventListener('mousedown', mousedownOutsideUserPickerEventListener);
    } else {
      this.userPickerOpen = false;
    }
  }

  /**
   * Handles user selection from user picker
   */
  selectUser(user: any): void {
    if (user) {
      this.selectedOwner = user.accountId || user.name || '';
      this.selectedOwnerDisplay = user.displayName || user.name || 'Unknown User';
      this.selectedUserObject = user;
    } else {
      this.selectedOwner = '';
      this.selectedOwnerDisplay = '';
      this.selectedUserObject = null;
    }
    
    // Close user picker
    this.userPickerOpen = false;
    
    // Refresh suggestions with new assignee filter
    this.updateFavoriteIssuesAndSuggestionsAndEmitSuggestion.next();
    this.cdr.detectChanges();
  }

  /**
   * Handles keydown events on the owner input to allow clearing with Delete/Backspace
   */
  onOwnerInputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.selectUser(null); // Clear selection
    }
  }

  /**
   * Updates worklog on the server (or adds new to the server) and closes the editor if update was successful
   */
  save(): void {
    this.saving = true;
    // Worklog existe garantizado cuando se invoca save
    const worklog = this.worklog!;
    if (this.adding) {
      this.worklogFacade.addWorklog$(worklog, this.start, this.durationMinutes * 60, this.commentString)
        .subscribe({
          next: () => this.close(),
          complete: () => {
            this.saving = false;
            this.cdr.detectChanges();
          }
        });
    } else {
      this.worklogFacade.updateWorklog$(worklog, this.start, this.durationMinutes * 60, this.commentString)
        .subscribe({
          next: () => this.close(),
          complete: () => {
            this.saving = false;
            this.cdr.detectChanges();
          }
        });
    }
  }

  isDateVisible(date: Date): boolean {
    return date.getDay() >= this.visibleDaysStart && date.getDay() <= this.visibleDaysEnd;
  }

  /**
   * Handles issue selection action from issue picker.
   */
  selectIssue(issue?: Issue | null): void {
    // If no issue provided, clear issue selection and return
    if (!issue) {
      if (this._worklog) {
        this._worklog.issue = undefined;
        this._worklog.issueId = undefined as any;
      }
      this.updatePanelHueSaturationAndIssueString(undefined as any, '');
      return;
    }

    // Set basic issue info immediately
    if (this._worklog) {
      this._worklog.issue = issue;
      this._worklog.issueId = issue.id;
    }
    this.updatePanelHueSaturationAndIssueString(issue, '');
    // Reset warning state
    this.missingEstimate = false;
    this.warningMessage = '';
    // Fetch full issue to get original estimate
    if (issue.key) {
      this.issueApi.getIssue$(issue.key).subscribe(full => {
        const chosen = full || issue;
        if (this._worklog) {
          this._worklog.issue = chosen;
        }
        this.updatePanelHueSaturationAndIssueString(chosen, '');
        const estimate = chosen.fields?.timeoriginalestimate ?? 0;
        if (estimate <= 0) {
          this.missingEstimate = true;
          this.warningMessage = 'No original estimate set';
        }
        this.cdr.detectChanges();
      });
    }
  }
  /** Guarda la estimación original introducida por el usuario */
  setOriginalEstimate(): void {
    if (!this._worklog?.issue?.key || !this.originalEstimateText) {
      return;
    }
    const key = this._worklog.issue.key;
    this.issueApi.updateOriginalEstimate$(key, this.originalEstimateText).subscribe(() => {
      // Recargar issue para reflejar la nueva estimación
      this.issueApi.getIssue$(key).subscribe(full => {
        if (full) {
          this._worklog!.issue = full;
          this.updatePanelHueSaturationAndIssueString(full);
          this.missingEstimate = false;
          this.originalEstimateText = '';
          this.cdr.detectChanges();
        }
      });
    });
  }

  updatePanelHueSaturationAndIssueString(issue?: Issue, defaultIssueString: string = '···'): void {
    if (issue) {
      const parentOrSelfId = issue.fields?.parent?.id ?? issue.id ?? '';
      this.panelHue = Math.round((Number(parentOrSelfId) * 360 / 1.61803)) % 360;
      this.panelSaturation = 50;
      this.issueString = issue.key + ' - ' + (issue.fields?.summary ?? '');
    } else {
      this.panelHue = 0;
      this.panelSaturation = 0;
      this.issueString = defaultIssueString;
    }
  }

  close(): void {
    this.cancelEdit.emit();
    this.worklog = null;
  }

  /**
   * Whether editor fields should be traversable with Tab.
   */
  shouldTabIndexBe0(): boolean {
    return !!this.worklog && !this.calendarOpen && !this.issuePickerOpen && !this.saving && !this.keysDisabled;
  }
}

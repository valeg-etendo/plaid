import {
  ChangeDetectionStrategy, ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild
} from '@angular/core';
import {Issue} from '../../../../model/issue';
import {Observable, Subject} from 'rxjs';
import {IssueFacade} from '../../../../core/issue/issue.facade';
import {debounceTime, switchMap, tap} from 'rxjs/operators';

/**
 * Presents a dropdown listing recent and favorite issues, searches through all issues, gives ability to add and remove
 * favorite issues, delegates selected issue to parent component.
 */
@Component({
  selector: 'plaid-issue-picker-cloud',
  templateUrl: './issue-picker-cloud.component.html',
  styleUrls: ['./issue-picker-cloud.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IssuePickerCloudComponent implements OnInit {
  private _open = false;
  searchInputSubject = new Subject<string>();
  searchResults: Issue[] = [];
  favorites: Issue[] = [];
  suggestions: Issue[] = [];
  searching = false;

  @ViewChild('searchInput', {static: true})
  searchInput: ElementRef<HTMLInputElement>;

  @Input()
  set open(open: boolean) {
    this._open = open;
    if (open) {
      setTimeout(() => this.searchInput.nativeElement.focus());
    } else {
      this.searchInput.nativeElement.value = '';
      this.searchResults = [];
    }
  }
  get open(): boolean {
    return this._open;
  }

  @Output()
  openChange = new EventEmitter<boolean>();

  @Output()
  issueChange = new EventEmitter<Issue>();

  @Input()
  updateFavoritesAndSuggestionsAndEmitSuggestion: Observable<void>;

  /**
   * Whether keyboard navigation should be disabled due to modal or another cloud being open.
   */
  @Input()
  keysDisabled: boolean;

  /**
   * Username (assignee) to filter issues by. If empty, shows current user's issues.
   */
  @Input()
  assignee: string;

  constructor(private issueFacade: IssueFacade, private cdr: ChangeDetectorRef) {
  }

  ngOnInit() {
    this.searchInputSubject.pipe(
      debounceTime(250),
      tap(() => {
        this.searching = true;
        this.cdr.detectChanges();
      }),
      switchMap(s => this.issueFacade.quickSearch$(s, this.assignee))
    ).subscribe(res => {
      this.searching = false;
      if (this.searchInput.nativeElement.value) {
        this.searchResults = res;
      }
      this.cdr.detectChanges();
    });

    if (this.updateFavoritesAndSuggestionsAndEmitSuggestion != null) {
      this.updateFavoritesAndSuggestionsAndEmitSuggestion.subscribe(() => {
        // ensure @Input() assignee has been updated by Angular change detection
        // before we call facade.fetchFavoritesAndSuggestions
        console.debug('[IssuePickerCloud] update trigger received, assignee =', this.assignee);
        setTimeout(() => {
          console.debug('[IssuePickerCloud] calling fetchFavoritesAndSuggestions with assignee =', this.assignee);
          this.issueFacade.fetchFavoritesAndSuggestions(this.assignee);
        }, 0);
      });
    }

    this.issueFacade.getFavorites$().subscribe(favorites => {
      this.favorites = favorites;
      this.cdr.detectChanges();
    });
    this.issueFacade.getSuggestions$().subscribe(suggestions => {
      this.suggestions = suggestions;
      if (suggestions.length > 0) {
        this.issueChange.emit(suggestions[0]);
      } else {
        this.issueChange.emit(undefined);
      }
      this.cdr.detectChanges();
    });

    // Trigger initial fetch for current assignee to populate suggestions/favorites on mount
    setTimeout(() => {
      console.debug('[IssuePickerCloud] ngOnInit initial fetch with assignee =', this.assignee);
      this.issueFacade.fetchFavoritesAndSuggestions(this.assignee);
    }, 0);
  }

  inputSearch(query: string): void {
    if (query) {
      this.searchInputSubject.next(query);
    } else {
      this.searching = false;
      this.searchResults = [];
    }
  }

  issueSelected(issue: Issue): void {
    this._open = false;
    this.openChange.emit(false);
    this.issueChange.emit(issue);
    this.searchResults = [];
    this.searchInput.nativeElement.value = '';
  }

  favoriteChange(issue: Issue, favorite: boolean): void {
    if (favorite) {
      this.issueFacade.addFavorite(issue);
    } else {
      this.issueFacade.removeFavorite(issue);
    }
  }

  get suggestionsWithoutFavorites(): Issue[] {
    return this.suggestions.filter(issue => !this.favorites.find(favorite => favorite.key === issue.key));
  }

  get suggestionsToShow(): Issue[] {
    // When no assignee is selected (empty string or null), show current user's suggestions without favorites
    // When specific assignee is selected, show all suggestions for that assignee
    if (!this.assignee || this.assignee.trim() === '') {
      // Current user: show suggestions that aren't already in favorites
      return this.suggestionsWithoutFavorites;
    } else {
      // Specific assignee: show all suggestions for that user
      return this.suggestions;
    }
  }

}

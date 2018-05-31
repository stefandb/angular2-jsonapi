import { TestBed } from '@angular/core/testing';
import { parse } from 'date-fns';
import { Author } from '../../test/models/author.model';
import {
    AUTHOR_ID, AUTHOR_NAME, AUTHOR_BIRTH, AUTHOR_DEATH,
    AUTHOR_CREATED, AUTHOR_UPDATED, getAuthorData, getIncludedBooks, BOOK_TITLE, BOOK_PUBLISHED, CHAPTER_TITLE
} from '../../test/fixtures/author.fixture';
import { Book } from '../../test/models/book.model';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Datastore } from '../../test/datastore.service';
import { Chapter } from '../../test/models/chapter.model';

let datastore: Datastore;

describe('JsonApiModel', () => {

  beforeEach(() => {

    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
      ],
      providers: [
        Datastore
      ]
    });

    datastore = TestBed.get(Datastore);
  });

  describe('constructor', () => {

    it('should be instantiated with attributes', () => {
      const DATA = {
        id: '1',
        attributes: {
          name: 'Daniele',
          surname: 'Ghidoli',
          date_of_birth: '1987-05-25'
        }
      };
      const author: Author = new Author(datastore, DATA);
      expect(author).toBeDefined();
      expect(author.id).toBe('1');
      expect(author.name).toBe('Daniele');
      expect(author.date_of_birth.getTime()).toBe(parse('1987-05-25').getTime());
    });

    it('should be instantiated without attributes', () => {
      const author: Author = new Author(datastore);
      expect(author).toBeDefined();
      expect(author.id).toBeUndefined();
      expect(author.date_of_birth).toBeUndefined();
    });

  });

  describe('syncRelationships', () => {

    let author: Author;

    it('should return the object when there is no relationship included', () => {
      author = new Author(datastore, getAuthorData());
      expect(author).toBeDefined();
      expect(author.id).toBe(AUTHOR_ID);
      expect(author.books).toBeUndefined();
    });

    describe('parseHasMany', () => {

      it('should return the parsed relationships when one is included', () => {
        const BOOK_NUMBER = 4;
        const DATA = getAuthorData('books', BOOK_NUMBER);
        author = new Author(datastore, DATA);
        author.syncRelationships(DATA, getIncludedBooks(BOOK_NUMBER), 0);
        expect(author).toBeDefined();
        expect(author.id).toBe(AUTHOR_ID);
        expect(author.books).toBeDefined();
        expect(author.books.length).toBe(BOOK_NUMBER);
        author.books.forEach((book: Book, index: number) => {
          expect(book instanceof Book).toBeTruthy();
          expect(+book.id).toBe(index + 1);
          expect(book.title).toBe(BOOK_TITLE);
          expect(book.date_published.valueOf()).toBe(parse(BOOK_PUBLISHED).valueOf());
        });
      });

      it('should parse infinite levels of relationships by reference', () => {
        const BOOK_NUMBER = 4;
        const DATA = getAuthorData('books', BOOK_NUMBER);
        author = new Author(datastore, DATA);
        datastore.addToStore(author);
        author.syncRelationships(DATA, getIncludedBooks(BOOK_NUMBER), 0);
        author.books.forEach((book: Book, index: number) => {
          expect(book.author).toBeDefined();
          expect(book.author).toEqual(author);
          expect(book.author.books[index]).toEqual(author.books[index]);
        });

      });

      it('should return the parsed relationships when two nested ones are included', () => {
        const REL = 'books,books.chapters';
        const BOOK_NUMBER = 2;
        const CHAPTERS_NUMBER = 4;
        const DATA = getAuthorData(REL, BOOK_NUMBER);
        const INCLUDED = getIncludedBooks(BOOK_NUMBER, REL, CHAPTERS_NUMBER);
        author = new Author(datastore, DATA);
        author.syncRelationships(DATA, INCLUDED, 0);
        expect(author).toBeDefined();
        expect(author.id).toBe(AUTHOR_ID);
        expect(author.books).toBeDefined();
        expect(author.books.length).toBe(BOOK_NUMBER);
        author.books.forEach((book: Book, index: number) => {
          expect(book instanceof Book).toBeTruthy();
          expect(+book.id).toBe(index + 1);
          expect(book.title).toBe(BOOK_TITLE);
          expect(book.date_published.valueOf()).toBe(parse(BOOK_PUBLISHED).valueOf());
          expect(book.chapters).toBeDefined();
          expect(book.chapters.length).toBe(CHAPTERS_NUMBER);
          book.chapters.forEach((chapter: Chapter, cindex: number) => {
            expect(chapter instanceof Chapter).toBeTruthy();
            expect(chapter.title).toBe(CHAPTER_TITLE);
            expect(chapter.book).toEqual(book);
          });
        });
      });

      describe('update relationships', () => {
        it ('should return updated relationship', () => {
          const REL = 'books';
          const BOOK_NUMBER = 1;
          const CHAPTERS_NUMBER = 4;
          const DATA = getAuthorData(REL, BOOK_NUMBER);
          const INCLUDED = getIncludedBooks(BOOK_NUMBER);
          const NEW_BOOK_TITLE = 'The Hobbit';
          author = new Author(datastore, DATA);
          author.syncRelationships(DATA, INCLUDED, 0);
          INCLUDED.forEach((model) => {
            if (model.type === 'books') {
              model.attributes.title = NEW_BOOK_TITLE;
            }
          });
          author.syncRelationships(DATA, INCLUDED, 0);
          author.books.forEach((book) => {
            expect(book.title).toBe(NEW_BOOK_TITLE);
          });
        });
      });
    });
  });
});
